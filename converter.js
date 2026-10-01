'use strict';

(function () {
  const MODULE_KEY = '__JACKDARCKART_CONVERTER__';
  const CLEANUP_WINDOW_MS = 2 * 60 * 1000;
  const ENHANCE_PREFERENCES_KEY = 'jackdarckart:studio:enhance';
  const DEFAULT_COMPRESSED_BITRATE = '192000';
  const PREFERRED_MP3_BITRATE = DEFAULT_COMPRESSED_BITRATE;
  const MP3_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mpeg;codecs=mp3'];
  const BROWSER_DEPENDENT_EXPORT_FORMATS = [
    {
      id: 'webm-opus',
      label: 'WebM / Opus · browserabhängig',
      extension: 'webm',
      mimeType: 'audio/webm;codecs=opus',
      description: 'WebM/Opus nutzt den Browser-Encoder in Echtzeit. Exportgeschwindigkeit hängt von Dauer und Browser ab.',
      approximate: true
    },
    {
      id: 'ogg-opus',
      label: 'Ogg / Opus · browserabhängig',
      extension: 'ogg',
      mimeType: 'audio/ogg;codecs=opus',
      description: 'Ogg/Opus erscheint nur bei nativer Browser-Unterstützung und wird lokal in Echtzeit aufgezeichnet.',
      approximate: true
    }
  ];
  const spectrumFftSize = 2048;
  let currentStudio = null;

  const CLOUD_SYNC_MESSAGES = {
    NOT_CONFIGURED: 'Cloud-Sync ist auf dieser Website noch nicht eingerichtet. Regler und Auto-Enhance-Einstellungen bleiben lokal in diesem Browser.',
    NETWORK: 'Keine Verbindung zum Cloudflare-Backend. Prüfe deine Internetverbindung und versuche es erneut.',
    OFFLINE: 'Das Cloudflare-Backend antwortet unter der konfigurierten Adresse nicht. Bitte später erneut versuchen.',
    SESSION_REQUIRED: 'Bitte melde dich an, um Studio-Presets in der Cloud zu speichern oder zu laden.',
    INVALID_CREDENTIALS: 'Handle oder Passwort ist falsch.',
    HANDLE_TAKEN: 'Dieser Handle ist bereits vergeben. Melde dich an, falls es dein Account ist.',
    HANDLE_INVALID: 'Der Handle muss 3–20 Zeichen lang sein und darf nur Buchstaben, Zahlen, _ oder - enthalten.',
    PASSWORD_INVALID: 'Das Passwort muss 10 bis 128 Zeichen lang sein.',
    CROSS_ORIGIN: 'Diese Website ist im Cloudflare-Backend nicht als erlaubte Origin freigegeben.',
    NOT_FOUND: 'Das Cloudflare-Backend kennt die Studio-Preset-Route noch nicht. Bitte den Worker aktualisieren.',
    STUDIO_PRESET_INVALID: 'Das Preset enthält ungültige Werte und wurde nicht gespeichert.',
    DB_UNAVAILABLE: 'Die Cloudflare-Datenbank (D1) ist nicht verbunden. Bitte später erneut versuchen.',
    SESSIONS_UNAVAILABLE: 'Der Cloudflare-Sitzungsspeicher (KV) ist nicht verbunden. Bitte später erneut versuchen.',
    INTERNAL_ERROR: 'Das Cloudflare-Backend konnte die Anfrage nicht verarbeiten. Bitte später erneut versuchen.'
  };

  function resolveCloudSyncBase(value) {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim().replace(/\/+$/, '');
    if (/^https:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(trimmed)) {
      return trimmed;
    }
    if (/^(\.\/|\/(?!\/))[^\s?#]*$/.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  /**
   * Talks to the Cloudflare Worker backend (cloudflare/src/worker.js).
   * Only slider values and Auto-Enhance preferences are synchronised; audio
   * files and rendered masters never leave the browser. Sessions are HttpOnly
   * cookies issued by the Worker, so no credentials are stored client-side.
   */
  class CloudflareStudioSyncAdapter {
    constructor(config) {
      const settings = config && typeof config === 'object' ? config : {};
      this.apiBase = resolveCloudSyncBase(settings.apiBase);
    }

    isConfigured() {
      return Boolean(this.apiBase);
    }

    async request(route, options) {
      if (!this.isConfigured()) {
        throw createCloudSyncError('NOT_CONFIGURED');
      }
      const fetchImplementation = (window && typeof window.fetch === 'function')
        ? window.fetch.bind(window)
        : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
      if (!fetchImplementation) {
        throw createCloudSyncError('NETWORK');
      }
      const settings = { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } };
      if (options && options.body !== undefined) {
        settings.method = 'POST';
        settings.headers['Content-Type'] = 'application/json';
        settings.body = JSON.stringify(options.body);
      }
      let response;
      try {
        response = await fetchImplementation(this.apiBase + route, settings);
      } catch (error) {
        throw createCloudSyncError('NETWORK');
      }
      const contentType = response && response.headers && typeof response.headers.get === 'function'
        ? String(response.headers.get('Content-Type') || '')
        : '';
      let payload = null;
      if (/application\/json/i.test(contentType)) {
        try {
          payload = await response.json();
        } catch (error) {
          payload = null;
        }
      }
      if (!payload || typeof payload !== 'object') {
        throw createCloudSyncError('OFFLINE');
      }
      if (!response.ok) {
        throw createCloudSyncError(payload.code || 'INTERNAL_ERROR');
      }
      return payload;
    }

    session() {
      return this.request('/session');
    }

    login(handle, password) {
      return this.request('/login', { body: { handle, password } });
    }

    register(handle, password) {
      return this.request('/register', { body: { handle, password } });
    }

    logout() {
      return this.request('/logout', { body: {} });
    }

    loadPreset() {
      return this.request('/studio-preset');
    }

    savePreset(preset) {
      return this.request('/studio-preset', { body: { preset } });
    }
  }

  function createCloudSyncError(code) {
    const error = new Error(CLOUD_SYNC_MESSAGES[code] || CLOUD_SYNC_MESSAGES.INTERNAL_ERROR);
    error.code = code;
    return error;
  }

  const QUALITY_WEIGHTS = {
    clipping: 30, squashed: 16, wide: 8, harshness: 14, brittle: 6, dull: 6,
    phase: 18, balance: 8, loudness: 14, tonality: 10, rumble: 8
  };
  // Share of each penalty the mastering chain can realistically repair.
  const QUALITY_FIX_RATES = {
    clipping: 0.45, squashed: 0.2, wide: 0.65, harshness: 0.8, brittle: 0.65, dull: 0.7,
    phase: 0.8, balance: 0.85, loudness: 0.9, tonality: 0.7, rumble: 0.9
  };
  const assessmentCache = new WeakMap();
  const enhancementCache = new WeakMap();

  function copyEnhancement(settings) {
    return {
      ...settings,
      artifactCleaner: settings.artifactCleaner ? { ...settings.artifactCleaner } : null,
      insight: { ...settings.insight }
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function harshnessSeverity(presenceTiltDb, trebleTiltDb) {
    return Math.max(clamp((presenceTiltDb + 4) / 6, 0, 1), clamp((trebleTiltDb + 11) / 6, 0, 1));
  }

  function rumbleSeverity(dcOffset, subRatioDb) {
    return Math.max(clamp(dcOffset / 0.03, 0, 1), clamp((subRatioDb + 6) / 6, 0, 1));
  }

  // Scan state layout: 0-3 filter memories (40/250/3500/8000 Hz one-poles),
  // 4-8 band energies (sub/low/mid/presence/air), 9 DC sum, 10 peak,
  // 11 clipped samples, 12 stereo cross product.
  const SCAN_STATE_SIZE = 13;

  // Small per-block kernel: invoked many times per file so the JIT optimises
  // it quickly instead of running one long, partially optimised loop.
  function scanBlock(channel, partner, start, end, state, coefficients) {
    const cSub = coefficients[0];
    const cLow = coefficients[1];
    const cMid = coefficients[2];
    const cHigh = coefficients[3];
    let fSub = state[0];
    let fLow = state[1];
    let fMid = state[2];
    let fHigh = state[3];
    let peak = state[10];
    let sub = 0;
    let low = 0;
    let mid = 0;
    let presence = 0;
    let air = 0;
    let dc = 0;
    let clipped = 0;
    let energy = 0;
    for (let i = start; i < end; i += 1) {
      const sample = channel[i];
      const absolute = sample < 0 ? -sample : sample;
      if (absolute > peak) peak = absolute;
      if (absolute >= 0.98) clipped += 1;
      energy += sample * sample;
      dc += sample;
      fSub += cSub * (sample - fSub);
      fLow += cLow * (sample - fLow);
      fMid += cMid * (sample - fMid);
      fHigh += cHigh * (sample - fHigh);
      const midBand = fMid - fLow;
      const presenceBand = fHigh - fMid;
      const airBand = sample - fHigh;
      sub += fSub * fSub;
      low += fLow * fLow;
      mid += midBand * midBand;
      presence += presenceBand * presenceBand;
      air += airBand * airBand;
    }
    let cross = 0;
    if (partner) {
      for (let i = start; i < end; i += 1) cross += channel[i] * partner[i];
    }
    state[0] = fSub;
    state[1] = fLow;
    state[2] = fMid;
    state[3] = fHigh;
    state[4] += sub;
    state[5] += low;
    state[6] += mid;
    state[7] += presence;
    state[8] += air;
    state[9] += dc;
    state[10] = peak;
    state[11] += clipped;
    state[12] += cross;
    return energy;
  }

  class BrowserAudioMasteringCore {
    constructor() {
      this.lowFrequency = 110;
      this.midFrequency = 2800;
      this.highFrequency = 7600;
      this.fallbackBufferContext = null;
    }

    analyzeBuffer(buffer) {
      if (!buffer) {
        return { peak: 0, rms: 0, loudnessDb: -Infinity };
      }

      let peak = 0;
      let sumSquares = 0;
      let sampleCount = 0;

      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        const channel = buffer.getChannelData(channelIndex);
        for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
          const sample = channel[sampleIndex] || 0;
          const absolute = Math.abs(sample);
          if (absolute > peak) {
            peak = absolute;
          }
          sumSquares += sample * sample;
          sampleCount += 1;
        }
      }

      const rms = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0;
      const loudnessDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      return { peak, rms, loudnessDb };
    }

    analyzeSource(buffer) {
      if (!buffer || !buffer.length || !buffer.sampleRate || !buffer.numberOfChannels) {
        throw new Error('Keine analysierbare Audioquelle.');
      }
      const length = buffer.length;
      const sampleRate = buffer.sampleRate;
      const coefficient = (hz) => 1 - Math.exp(-2 * Math.PI * Math.min(hz, sampleRate * 0.45) / sampleRate);
      const filterCoefficients = [coefficient(40), coefficient(250), coefficient(3500), coefficient(8000)];
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));
      const channelCount = channels.length;
      const blockSize = Math.max(1, Math.round(sampleRate * 0.2));
      const blockCount = Math.ceil(length / blockSize);
      const blockEnergy = new Float64Array(blockCount);
      const channelEnergy = [0, 0];
      const sums = new Float64Array(SCAN_STATE_SIZE);
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        const channel = channels[channelIndex];
        const partner = channelIndex === 1 ? channels[0] : null;
        const state = new Float64Array(SCAN_STATE_SIZE);
        let energy = 0;
        for (let block = 0, start = 0; start < length; block += 1, start += blockSize) {
          const blockSum = scanBlock(channel, partner, start, Math.min(length, start + blockSize), state, filterCoefficients);
          blockEnergy[block] += blockSum;
          energy += blockSum;
        }
        // Non-finite samples propagate into the DC and energy sums.
        if (!Number.isFinite(state[9]) || !Number.isFinite(energy)) throw new Error('Ungültige Audiodaten.');
        for (let index = 4; index < SCAN_STATE_SIZE; index += 1) {
          sums[index] = index === 10 ? Math.max(sums[index], state[index]) : sums[index] + state[index];
        }
        channelEnergy[channelIndex] = energy;
      }
      const peak = sums[10];
      const clipped = sums[11];
      const count = length * channelCount;
      const sum = channelEnergy[0] + channelEnergy[1];
      const rms = Math.sqrt(sum / count);
      const bandRms = [sums[5], sums[6], sums[7], sums[8]].map((value) => Math.sqrt(value / count));
      const tilt = (a, b) => 20 * Math.log10((a + 1e-8) / (b + 1e-8));
      const bassTiltDb = tilt(bandRms[0], bandRms[1]);
      const presenceTiltDb = tilt(bandRms[2], bandRms[1]);
      const trebleTiltDb = tilt(bandRms[3], bandRms[1]);
      const crestDb = tilt(peak, rms);
      const correlation = channelCount === 2 && channelEnergy[0] * channelEnergy[1] > 0
        ? sums[12] / Math.sqrt(channelEnergy[0] * channelEnergy[1]) : 1;
      const blockLevels = this.measureBlockLevels(blockEnergy, blockSize, length, channelCount);
      const loudnessDb = rms ? 20 * Math.log10(rms) : -Infinity;
      const audible = rms > 1e-5;
      const dcOffset = Math.abs(sums[9] / count);
      const subRatioDb = tilt(Math.sqrt(sums[4] / count), rms);
      return {
        peak, rms, loudnessDb,
        gatedLoudnessDb: Number.isFinite(blockLevels.gatedDb) ? blockLevels.gatedDb : loudnessDb,
        loudnessRangeDb: blockLevels.rangeDb,
        bandRms, bassTiltDb, presenceTiltDb, trebleTiltDb,
        brightnessDb: tilt(bandRms[2] + bandRms[3], bandRms[0] + bandRms[1]),
        crestDb, clippingRatio: clipped / count, stereoCorrelation: correlation,
        channelCount,
        balanceDb: channelCount === 2 && channelEnergy[0] > 0 && channelEnergy[1] > 0
          ? 10 * Math.log10(channelEnergy[0] / channelEnergy[1]) : 0,
        dcOffset, subRatioDb,
        harshness: audible && harshnessSeverity(presenceTiltDb, trebleTiltDb) > 0.3,
        phasey: correlation < -0.15,
        brittle: audible && crestDb > 15 && (presenceTiltDb > -5 || trebleTiltDb > -12),
        rumble: audible && rumbleSeverity(dcOffset, subRatioDb) >= 0.5
      };
    }

    measureBlockLevels(blockEnergy, blockSize, length, channelCount) {
      const levels = [];
      let absoluteEnergy = 0;
      for (let block = 0; block < blockEnergy.length; block += 1) {
        const frames = Math.min(blockSize, length - block * blockSize);
        const meanSquare = blockEnergy[block] / (frames * channelCount);
        if (meanSquare > 1e-7) {
          levels.push(meanSquare);
          absoluteEnergy += meanSquare;
        }
      }
      if (!levels.length) {
        return { gatedDb: -Infinity, rangeDb: 0 };
      }
      const relativeGate = (absoluteEnergy / levels.length) * 0.01;
      const gated = levels.filter((value) => value >= relativeGate);
      const gatedMean = gated.reduce((total, value) => total + value, 0) / gated.length;
      let rangeDb = 0;
      if (gated.length >= 3) {
        const sorted = gated.map((value) => 10 * Math.log10(value)).sort((a, b) => a - b);
        const pick = (ratio) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio))];
        rangeDb = pick(0.95) - pick(0.1);
      }
      return { gatedDb: 10 * Math.log10(gatedMean), rangeDb };
    }

    assessProfile(profile) {
      if (!profile || typeof profile !== 'object') {
        return null;
      }
      const cached = assessmentCache.get(profile);
      if (cached) {
        return cached;
      }
      const audible = Number(profile.rms) > 1e-5;
      const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
      const loudness = Number.isFinite(profile.gatedLoudnessDb) ? profile.gatedLoudnessDb : profile.loudnessDb;
      const crest = number(profile.crestDb, 12);
      const clippingRatio = number(profile.clippingRatio, 0);
      const correlation = number(profile.stereoCorrelation, 1);
      const severities = {
        clipping: clippingRatio <= 0.0002 ? 0 : clamp(0.35 + (clippingRatio - 0.001) * 65, 0.15, 1),
        squashed: audible ? clamp((10 - crest) / 6, 0, 1) : 0,
        wide: audible ? Math.max(clamp((number(profile.loudnessRangeDb, 0) - 12) / 10, 0, 1), clamp((crest - 20) / 8, 0, 1)) : 0,
        harshness: audible ? harshnessSeverity(number(profile.presenceTiltDb, -10), number(profile.trebleTiltDb, -20)) : 0,
        brittle: profile.brittle ? 1 : 0,
        dull: audible ? clamp((-26 - number(profile.trebleTiltDb, -20)) / 10, 0, 1) : 0,
        phase: number(profile.channelCount, 2) === 2 ? clamp((0.25 - correlation) / 0.75, 0, 1) : 0,
        balance: clamp((Math.abs(number(profile.balanceDb, 0)) - 1.5) / 4.5, 0, 1),
        loudness: Number.isFinite(loudness) ? clamp((Math.abs(loudness + 14) - 3) / 9, 0, 1) : 1,
        tonality: audible ? clamp((Math.abs(number(profile.bassTiltDb, 2) - 2) - 4) / 8, 0, 1) : 0,
        rumble: audible ? rumbleSeverity(number(profile.dcOffset, 0), number(profile.subRatioDb, -40)) : 0
      };
      const penalties = {};
      let score = 100;
      Object.keys(QUALITY_WEIGHTS).forEach((key) => {
        penalties[key] = key === 'loudness' && !Number.isFinite(loudness)
          ? 30
          : QUALITY_WEIGHTS[key] * severities[key];
        score -= penalties[key];
      });
      score = Math.round(clamp(score, 0, 100));
      const deficit = (100 - score) / 100;
      const worst = Math.max(...Object.values(severities));
      // A single severe problem lifts the intensity even if the overall score
      // still looks acceptable; mild findings on clean sources do not.
      const urgency = clamp((worst - 0.4) / 0.6, 0, 1);
      // Poor sources receive clearly stronger corrections, clean sources
      // are only nudged so the master does not get over-processed.
      const intensity = clamp(0.5 + 1.25 * deficit + 0.15 * urgency, 0.5, 1.75);
      // How much of a strength above "ausgewogen" may be used: clean sources
      // only receive a fraction of the extra push, weak sources all of it.
      const need = clamp(0.3 + 1.4 * deficit + 0.4 * urgency, 0.3, 1);
      const assessment = { severities, penalties, score, intensity, need, loudnessDb: loudness };
      assessmentCache.set(profile, assessment);
      return assessment;
    }

    chooseEnhancement(profile, options) {
      const assessment = this.assessProfile(profile);
      if (!assessment) {
        throw new Error('Kein Quellenprofil verfügbar.');
      }
      const strength = clamp(Number((options && options.strength) ?? 1) || 1, 0.3, 2.2);
      let cached = enhancementCache.get(profile);
      if (!cached) {
        cached = new Map();
        enhancementCache.set(profile, cached);
      }
      const hit = cached.get(strength);
      if (hit) {
        return copyEnhancement(hit);
      }
      const settings = this.computeEnhancement(profile, assessment, strength);
      cached.set(strength, settings);
      return copyEnhancement(settings);
    }

    computeEnhancement(profile, assessment, strength) {
      const s = assessment.severities;
      const effectiveStrength = strength <= 1 ? strength : 1 + (strength - 1) * assessment.need;
      const amount = clamp(effectiveStrength * assessment.intensity, 0.2, 2.6);
      const blend = (neutral, value) => neutral + (value - neutral) * amount;
      const loud = assessment.loudnessDb;
      const squash = Math.max(s.squashed, s.clipping);
      const compressed = squash >= 0.15;
      const brittle = Boolean(profile.brittle);
      const harsh = Boolean(profile.harshness);

      let ratio = 2.2 + 1.8 * s.wide;
      let threshold = -20 - 5 * s.wide;
      if (compressed) {
        ratio = 1.6 - 0.4 * squash;
        threshold = -12 + 2 * squash;
      }

      let width = 100;
      if (s.phase > 0) {
        width = 100 - 50 * s.phase;
      } else if (profile.channelCount === 2 && profile.stereoCorrelation > 0.8 && profile.stereoCorrelation < 0.97) {
        width = 110;
      }

      let target = -12;
      if (compressed || loud > -12) {
        target = -14;
      } else if (s.wide > 0.3) {
        target = -13;
      }

      const clipped = s.clipping >= 0.3;
      const unbalanced = profile.channelCount === 2 && s.balance > 0;
      const cleaner = harsh || profile.phasey || brittle || profile.rumble || clipped || unbalanced
        ? {
          presenceCut: harsh ? clamp(blend(0, -(2 + 2.5 * s.harshness)), -8, 0) : 0,
          highCut: harsh || brittle || clipped
            ? clamp(blend(0, -(1.2 + 1.6 * Math.max(s.harshness, s.brittle, 0.8 * s.clipping))), -6, 0)
            : 0,
          softenTransients: brittle,
          rumbleCut: profile.rumble ? Math.round(30 + 10 * clamp(amount - 1, 0, 1) * s.rumble) : 0,
          // Positive values lift the right channel, negative ones the left.
          balanceTrim: unbalanced
            ? Number(clamp(Number(profile.balanceDb) * clamp(amount * 0.85, 0, 1), -6, 6).toFixed(2))
            : 0
        }
        : null;
      const airLift = clamp((-12 - profile.trebleTiltDb) * 0.22, -3.5, 3) + 1.2 * s.dull;
      // Lifting the air band of a clipped source would only expose the
      // distortion, so the lift is scaled back by the clipping severity.
      const airMove = (airLift > 0 ? airLift * (1 - 0.8 * s.clipping) : airLift)
        - 0.8 * s.harshness - 0.5 * s.brittle;
      const settings = {
        eqLow: clamp(blend(0, clamp((2 - profile.bassTiltDb) * 0.3, -4, 4) - 0.5 * s.rumble), -6, 6),
        eqMid: clamp(blend(0, clamp(-profile.presenceTiltDb * 0.22, -3, 2.5) - 0.8 * s.harshness), -6, 4),
        eqHigh: clamp(blend(0, airMove), -6, 6),
        compThreshold: blend(-18, threshold),
        compRatio: clamp(blend(1, ratio), 1, 5),
        limiterCeiling: s.clipping > 0 ? -1 - 1.5 * s.clipping : -1,
        stereoWidth: clamp(blend(100, width), 40, 130),
        targetLufs: blend(-12, target),
        artifactCleaner: cleaner
      };
      settings.insight = {
        score: assessment.score,
        strength,
        intensity: amount,
        projectedScore: this.projectScore(assessment, amount)
      };
      return settings;
    }

    projectScore(assessment, amount) {
      if (!assessment) {
        return null;
      }
      const coverage = clamp(amount, 0, 1);
      let projected = 100;
      Object.keys(assessment.penalties).forEach((key) => {
        const fix = assessment.penalties[key] >= 30 && key === 'loudness' ? 0 : (QUALITY_FIX_RATES[key] || 0);
        projected -= assessment.penalties[key] * (1 - fix * coverage);
      });
      return Math.round(clamp(Math.max(projected, assessment.score), 0, 100));
    }

    scoreProfile(profile) {
      const assessment = this.assessProfile(profile);
      return assessment ? assessment.score : null;
    }

    describeProfile(profile) {
      const assessment = this.assessProfile(profile);
      if (!assessment) {
        return [{
          id: 'unavailable',
          tone: 'warn',
          label: 'Analyse nicht verfügbar',
          detail: 'Die Quelle konnte nicht vollständig vermessen werden. Es greift ein neutrales Standard-Preset.'
        }];
      }
      const s = assessment.severities;
      const tone = (severity) => (severity >= 0.6 ? 'alert' : (severity >= 0.2 ? 'warn' : 'good'));
      const findings = [];
      const dB = (value) => (value > 0 ? '+' : '') + value.toFixed(1) + ' dB';
      findings.push(profile.clippingRatio > 0.0002
        ? { id: 'clipping', tone: s.clipping >= 0.3 ? 'alert' : 'warn', label: 'Clipping erkannt', detail: (profile.clippingRatio * 100).toFixed(2) + ' % der Samples liegen am Anschlag. Limiter-Ceiling wird abgesenkt und die Kompression geschont.' }
        : { id: 'clipping', tone: 'good', label: 'Kein Clipping', detail: 'Die Spitzenpegel der Quelle bleiben unterhalb der Übersteuerungsgrenze.' });
      const range = Number.isFinite(profile.loudnessRangeDb) ? ' · Lautheitsumfang ' + profile.loudnessRangeDb.toFixed(1) + ' dB' : '';
      if (s.squashed >= 0.2) {
        findings.push({ id: 'dynamics', tone: tone(s.squashed), label: 'Dynamik stark komprimiert', detail: 'Crest-Faktor ' + profile.crestDb.toFixed(1) + ' dB' + range + '. Die Kompression wird bewusst schonend eingestellt.' });
      } else if (s.wide >= 0.2) {
        findings.push({ id: 'dynamics', tone: 'warn', label: 'Sehr große Dynamik', detail: 'Crest-Faktor ' + profile.crestDb.toFixed(1) + ' dB' + range + '. Der Kompressor gleicht leise und laute Passagen stärker an.' });
      } else {
        findings.push({ id: 'dynamics', tone: 'good', label: 'Dynamik in Ordnung', detail: 'Crest-Faktor ' + profile.crestDb.toFixed(1) + ' dB' + range + ' bietet genug Spielraum für sauberes Mastering.' });
      }
      findings.push(profile.harshness || profile.brittle
        ? { id: 'harshness', tone: tone(Math.max(s.harshness, s.brittle * 0.5)), label: 'Harsche Höhen', detail: 'Präsenz ' + dB(profile.presenceTiltDb) + ' · Höhen ' + dB(profile.trebleTiltDb) + '. Artefakt-Reinigung wird aktiviert.' }
        : (s.dull >= 0.2
          ? { id: 'harshness', tone: 'warn', label: 'Dumpfe Höhen', detail: 'Höhen ' + dB(profile.trebleTiltDb) + ' gegenüber den Mitten. Der Air-EQ hebt behutsam an.' }
          : { id: 'harshness', tone: 'good', label: 'Höhen ausgewogen', detail: 'Präsenz ' + dB(profile.presenceTiltDb) + ' · Höhen ' + dB(profile.trebleTiltDb) + '.' }));
      findings.push(profile.phasey || s.phase >= 0.2
        ? { id: 'stereo', tone: profile.phasey ? 'alert' : 'warn', label: 'Phasiges Stereobild', detail: 'Korrelation ' + profile.stereoCorrelation.toFixed(2) + '. Die Stereobreite wird für Mono-Kompatibilität reduziert.' }
        : { id: 'stereo', tone: 'good', label: 'Stereobild stabil', detail: 'Korrelation ' + profile.stereoCorrelation.toFixed(2) + ' bleibt mono-kompatibel.' });
      if (profile.channelCount === 2) {
        findings.push(s.balance >= 0.2
          ? { id: 'balance', tone: tone(s.balance), label: 'Kanäle unausgewogen', detail: (profile.balanceDb > 0 ? 'Links' : 'Rechts') + ' ist ' + Math.abs(profile.balanceDb).toFixed(1) + ' dB lauter. Das fließt in den Qualitäts-Score ein.' }
          : { id: 'balance', tone: 'good', label: 'Kanäle ausgewogen', detail: 'Links/Rechts-Differenz ' + Math.abs(profile.balanceDb || 0).toFixed(1) + ' dB.' });
      }
      findings.push({
        id: 'tonality',
        tone: tone(s.tonality),
        label: s.tonality >= 0.2 ? (profile.bassTiltDb > 2 ? 'Bassbetonte Quelle' : 'Bassarme Quelle') : 'Tonale Balance in Ordnung',
        detail: 'Bass-Tilt ' + dB(profile.bassTiltDb) + ' gegenüber den unteren Mitten.'
      });
      if (profile.rumble) {
        findings.push({ id: 'rumble', tone: tone(s.rumble), label: 'Rumpeln / DC-Versatz', detail: 'Tiefstfrequenz-Anteil ' + dB(profile.subRatioDb) + '. Ein Rumpel-Filter unter 30 Hz räumt den Bass auf.' });
      }
      const loudness = assessment.loudnessDb;
      findings.push({
        id: 'loudness',
        tone: Number.isFinite(loudness) ? tone(s.loudness) : 'warn',
        label: Number.isFinite(loudness)
          ? (loudness > -8 ? 'Sehr laute Quelle' : (loudness < -20 ? 'Sehr leise Quelle' : 'Lautheit im Zielbereich'))
          : 'Lautheit nicht bestimmbar',
        detail: Number.isFinite(loudness)
          ? 'approx. ' + loudness.toFixed(1) + ' LUFS (gegated) vor dem Mastering.'
          : 'Für diese Quelle liess sich keine Lautheit schätzen.'
      });
      return findings;
    }

    summarizeEnhancement(settings) {
      if (!settings) {
        return [];
      }
      const dB = (value) => (value > 0 ? '+' : '') + Number(value).toFixed(1) + ' dB';
      const steps = [
        'EQ: Bass ' + dB(settings.eqLow) + ' · Präsenz ' + dB(settings.eqMid) + ' · Höhen ' + dB(settings.eqHigh),
        'Kompressor: Threshold ' + Number(settings.compThreshold).toFixed(1) + ' dB bei ' + Number(settings.compRatio).toFixed(1) + ':1',
        'Limiter-Ceiling ' + Number(settings.limiterCeiling).toFixed(1) + ' dBFS · Ziel ' + Number(settings.targetLufs).toFixed(1) + ' LUFS approx.',
        'Stereobreite ' + Math.round(Number(settings.stereoWidth)) + ' %'
      ];
      if (settings.artifactCleaner) {
        const parts = [];
        if (settings.artifactCleaner.presenceCut) {
          parts.push('Ringing-Cut bei 4.4 kHz ' + dB(settings.artifactCleaner.presenceCut));
        }
        if (settings.artifactCleaner.highCut) {
          parts.push('Höhen-Glättung ' + dB(settings.artifactCleaner.highCut));
        }
        if (settings.artifactCleaner.softenTransients) {
          parts.push('schnellere Transienten-Kontrolle');
        }
        if (settings.artifactCleaner.rumbleCut) {
          parts.push('Rumpel-Filter unter ' + Math.round(settings.artifactCleaner.rumbleCut) + ' Hz');
        }
        if (settings.artifactCleaner.balanceTrim) {
          parts.push('Kanalausgleich ' + Math.abs(settings.artifactCleaner.balanceTrim).toFixed(1) + ' dB zugunsten '
            + (settings.artifactCleaner.balanceTrim > 0 ? 'rechts' : 'links'));
        }
        steps.push('Artefakt-Reinigung: ' + (parts.length ? parts.join(' · ') : 'aktiv'));
      }
      const insight = settings.insight;
      if (insight && Number.isFinite(insight.score)) {
        steps.push('Korrekturintensität ' + Math.round(insight.intensity * 100) + ' % · Score ' + insight.score
          + (Number.isFinite(insight.projectedScore) ? ' → Prognose approx. ' + insight.projectedScore : ''));
      }
      return steps;
    }

    createPreviewChain(context, settings, analyser, sourceChannelCount) {
      const input = context.createGain();
      const lowEq = context.createBiquadFilter();
      lowEq.type = 'lowshelf';
      lowEq.frequency.value = this.lowFrequency;
      lowEq.gain.value = settings.eqLow;

      const midEq = context.createBiquadFilter();
      midEq.type = 'peaking';
      midEq.frequency.value = this.midFrequency;
      midEq.Q.value = 1.1;
      midEq.gain.value = settings.eqMid;

      const highEq = context.createBiquadFilter();
      highEq.type = 'highshelf';
      highEq.frequency.value = this.highFrequency;
      highEq.gain.value = settings.eqHigh;

      const cleaner = settings.artifactCleaner;
      const rumbleCut = cleaner && cleaner.rumbleCut ? context.createBiquadFilter() : null;
      if (rumbleCut) {
        rumbleCut.type = 'highpass';
        rumbleCut.frequency.value = cleaner.rumbleCut;
        rumbleCut.Q.value = 0.707;
      }
      const ringCut = cleaner && cleaner.presenceCut ? context.createBiquadFilter() : null;
      if (ringCut) {
        ringCut.type = 'peaking';
        ringCut.frequency.value = 4400;
        ringCut.Q.value = 3;
        ringCut.gain.value = cleaner.presenceCut;
      }
      const airCut = cleaner && cleaner.highCut ? context.createBiquadFilter() : null;
      if (airCut) {
        airCut.type = 'highshelf';
        airCut.frequency.value = 6500;
        airCut.gain.value = cleaner.highCut;
      }
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = settings.compThreshold;
      compressor.knee.value = 18;
      compressor.ratio.value = settings.compRatio;
      compressor.attack.value = cleaner && cleaner.softenTransients ? 0.003 : 0.01;
      compressor.release.value = 0.16;

      const makeup = context.createGain();
      makeup.gain.value = this.getMakeupGain(settings);

      const widthStage = this.createStereoWidthStage(context, settings.stereoWidth, sourceChannelCount,
        cleaner && cleaner.balanceTrim ? cleaner.balanceTrim : 0);
      const limiter = context.createWaveShaper();
      limiter.curve = this.createLimiterCurve(this.dbToLinear(settings.limiterCeiling));
      limiter.oversample = '4x';

      if (rumbleCut) {
        input.connect(rumbleCut);
        rumbleCut.connect(lowEq);
      } else {
        input.connect(lowEq);
      }
      lowEq.connect(midEq);
      midEq.connect(highEq);
      let tail = highEq;
      if (ringCut) { tail.connect(ringCut); tail = ringCut; }
      if (airCut) { tail.connect(airCut); tail = airCut; }
      tail.connect(compressor);
      compressor.connect(makeup);
      makeup.connect(widthStage.input);
      widthStage.output.connect(limiter);
      limiter.connect(analyser);

      return { input, output: analyser };
    }

    async render(buffer, settings, targetSampleRate) {
      const sampleRate = Number.isFinite(targetSampleRate) ? targetSampleRate : buffer.sampleRate;
      const channelCount = Math.min(2, Math.max(1, buffer.numberOfChannels));
      const frameCount = Math.max(1, Math.ceil(buffer.duration * sampleRate));
      const offlineContext = this.createOfflineContext(channelCount, frameCount, sampleRate);
      const source = offlineContext.createBufferSource();
      source.buffer = buffer;

      const analyser = offlineContext.createAnalyser();
      const chain = this.createPreviewChain(offlineContext, settings, analyser, buffer.numberOfChannels);
      chain.output.connect(offlineContext.destination);
      source.connect(chain.input);
      source.start(0);

      const rendered = await offlineContext.startRendering();
      return this.finalizeRenderedBuffer(rendered, settings);
    }

    finalizeRenderedBuffer(buffer, settings) {
      const widthBuffer = this.cloneBufferWithWidth(buffer, settings.stereoWidth);
      const beforeNormalization = this.analyzeBuffer(widthBuffer);
      const ceilingLinear = this.dbToLinear(settings.limiterCeiling);
      const loudnessGain = Number.isFinite(beforeNormalization.loudnessDb)
        ? this.dbToLinear(settings.targetLufs - beforeNormalization.loudnessDb)
        : 1;
      const peakAfterGain = beforeNormalization.peak * loudnessGain;
      const limiterGain = peakAfterGain > ceilingLinear && peakAfterGain > 0
        ? ceilingLinear / peakAfterGain
        : 1;
      const appliedGain = loudnessGain * limiterGain;
      const limitedBuffer = this.applyGainAndCeiling(widthBuffer, appliedGain, ceilingLinear);
      const finalAnalysis = this.analyzeBuffer(limitedBuffer);

      return {
        buffer: limitedBuffer,
        report: {
          inputApproxLufs: beforeNormalization.loudnessDb,
          outputApproxLufs: finalAnalysis.loudnessDb,
          peakBefore: beforeNormalization.peak,
          peakAfter: finalAnalysis.peak,
          appliedGainDb: 20 * Math.log10(appliedGain || 1)
        }
      };
    }

    cloneBufferWithWidth(buffer, stereoWidthPercent) {
      const output = this.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        output.copyToChannel(buffer.getChannelData(channelIndex), channelIndex);
      }

      if (buffer.numberOfChannels < 2) {
        return output;
      }

      const left = output.getChannelData(0);
      const right = output.getChannelData(1);
      const width = Math.max(0, stereoWidthPercent) / 100;
      for (let index = 0; index < left.length; index += 1) {
        const mid = (left[index] + right[index]) * 0.5;
        const side = (left[index] - right[index]) * 0.5 * width;
        left[index] = mid + side;
        right[index] = mid - side;
      }

      return output;
    }

    applyGainAndCeiling(buffer, gainValue, ceilingLinear) {
      const output = this.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        const input = buffer.getChannelData(channelIndex);
        const channel = new Float32Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          const amplified = input[index] * gainValue;
          channel[index] = Math.max(-ceilingLinear, Math.min(ceilingLinear, amplified));
        }
        output.copyToChannel(channel, channelIndex);
      }

      return output;
    }

    createBuffer(numberOfChannels, length, sampleRate) {
      const AudioBufferCtor = window.AudioBuffer || globalThis.AudioBuffer;
      if (typeof AudioBufferCtor === 'function') {
        return new AudioBufferCtor({
          length,
          numberOfChannels,
          sampleRate
        });
      }

      if (!this.fallbackBufferContext) {
        this.fallbackBufferContext = this.createOfflineContext(1, 1, sampleRate);
      }
      return this.fallbackBufferContext.createBuffer(numberOfChannels, length, sampleRate);
    }

    createOfflineContext(numberOfChannels, length, sampleRate) {
      const OfflineCtor = window.OfflineAudioContext
        || window.webkitOfflineAudioContext
        || globalThis.OfflineAudioContext
        || globalThis.webkitOfflineAudioContext;
      if (typeof OfflineCtor !== 'function') {
        throw new Error('OfflineAudioContext wird von diesem Browser nicht unterstützt.');
      }
      return new OfflineCtor(numberOfChannels, length, sampleRate);
    }

    getMakeupGain(settings) {
      const eqBoost = Math.max(settings.eqLow, 0) + Math.max(settings.eqMid, 0) + Math.max(settings.eqHigh, 0);
      const ratioPush = Math.max(settings.compRatio - 1, 0) * 0.12;
      return Math.max(0.5, Math.min(1.9, this.dbToLinear((eqBoost * 0.18) + ratioPush)));
    }

    createStereoWidthStage(context, stereoWidthPercent, sourceChannelCount, balanceTrimDb) {
      if (sourceChannelCount < 2) {
        const passthrough = context.createGain();
        return { input: passthrough, output: passthrough };
      }

      const width = Math.max(0, stereoWidthPercent) / 100;
      const input = context.createChannelSplitter(2);
      const merger = context.createChannelMerger(2);
      const leftDirect = context.createGain();
      const rightDirect = context.createGain();
      const leftCross = context.createGain();
      const rightCross = context.createGain();

      // Channel balance correction is folded into the width matrix, so it
      // costs no extra nodes in preview or offline render. Each path is scaled
      // by its source channel: leftCross carries input 1 (right), rightCross input 0 (left).
      const trim = Number.isFinite(balanceTrimDb) ? balanceTrimDb : 0;
      const leftGain = this.dbToLinear(-trim / 2);
      const rightGain = this.dbToLinear(trim / 2);
      leftDirect.gain.value = (1 + width) * 0.5 * leftGain;
      rightDirect.gain.value = (1 + width) * 0.5 * rightGain;
      leftCross.gain.value = (1 - width) * 0.5 * rightGain;
      rightCross.gain.value = (1 - width) * 0.5 * leftGain;

      input.connect(leftDirect, 0);
      input.connect(rightCross, 0);
      input.connect(rightDirect, 1);
      input.connect(leftCross, 1);

      leftDirect.connect(merger, 0, 0);
      leftCross.connect(merger, 0, 0);
      rightDirect.connect(merger, 0, 1);
      rightCross.connect(merger, 0, 1);

      return { input, output: merger };
    }

    createLimiterCurve(limit) {
      const length = 1024;
      const curve = new Float32Array(length);
      for (let index = 0; index < length; index += 1) {
        const x = (index / (length - 1)) * 2 - 1;
        const scaled = x / Math.max(limit, 0.05);
        curve[index] = Math.tanh(scaled) * limit;
      }
      return curve;
    }

    dbToLinear(value) {
      return Math.pow(10, value / 20);
    }

    encodeWav(buffer) {
      const channels = [];
      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        channels.push(buffer.getChannelData(channelIndex));
      }

      const interleaved = this.interleaveChannels(channels);
      const dataLength = interleaved.length * 2;
      const arrayBuffer = new ArrayBuffer(44 + dataLength);
      const view = new DataView(arrayBuffer);
      this.writeAscii(view, 0, 'RIFF');
      view.setUint32(4, 36 + dataLength, true);
      this.writeAscii(view, 8, 'WAVE');
      this.writeAscii(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, buffer.numberOfChannels, true);
      view.setUint32(24, buffer.sampleRate, true);
      view.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * 2, true);
      view.setUint16(32, buffer.numberOfChannels * 2, true);
      view.setUint16(34, 16, true);
      this.writeAscii(view, 36, 'data');
      view.setUint32(40, dataLength, true);

      let offset = 44;
      for (let index = 0; index < interleaved.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, interleaved[index]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }

      return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    interleaveChannels(channels) {
      if (!channels.length) {
        return new Float32Array(0);
      }
      if (channels.length === 1) {
        return channels[0];
      }

      const frameCount = channels[0].length;
      const interleaved = new Float32Array(frameCount * channels.length);
      let writeIndex = 0;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
          interleaved[writeIndex] = channels[channelIndex][frameIndex] || 0;
          writeIndex += 1;
        }
      }
      return interleaved;
    }

    writeAscii(view, offset, text) {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    }
  }

  function bootstrap() {
    const root = document.getElementById('converter-dropzone-shell');
    if (!root) {
      destroy();
      return;
    }

    if (currentStudio && typeof currentStudio.destroy === 'function') {
      currentStudio.destroy();
    }

    currentStudio = createStudio();
    currentStudio.init();
  }

  function destroy() {
    if (!currentStudio) {
      return;
    }
    currentStudio.destroy();
    currentStudio = null;
  }

  function createStudio() {
    const core = new BrowserAudioMasteringCore();
    const cloudSync = new CloudflareStudioSyncAdapter((readConverterConfig() || {}).cloudSync);
    const elements = {
      fileInput: document.getElementById('converter-file-input'),
      browseButton: document.getElementById('converter-browse-button'),
      resetButton: document.getElementById('converter-reset-button'),
      dropzone: document.getElementById('converter-dropzone-shell'),
      importStatus: document.getElementById('converter-import-status'),
      fileName: document.getElementById('converter-file-name'),
      fileDuration: document.getElementById('converter-file-duration'),
      fileRate: document.getElementById('converter-file-rate'),
      fileSize: document.getElementById('converter-file-size'),
      fileFormat: document.getElementById('converter-file-format'),
      fileChannels: document.getElementById('converter-file-channels'),
      autoEnhance: document.getElementById('converter-auto-enhance'),
      autoEnhanceUndo: document.getElementById('converter-auto-enhance-undo'),
      autoEnhanceToggle: document.getElementById('converter-auto-enhance-toggle'),
      autoEnhanceStrength: document.getElementById('converter-auto-enhance-strength'),
      autoEnhanceStrengthHint: document.getElementById('converter-auto-enhance-strength-hint'),
      enhanceStatus: document.getElementById('converter-enhance-status'),
      enhanceFindings: document.getElementById('converter-enhance-findings'),
      enhanceSteps: document.getElementById('converter-enhance-steps'),
      enhanceScore: document.getElementById('converter-enhance-score'),
      enhanceScoreBar: document.getElementById('converter-enhance-score-bar'),
      enhanceScoreNote: document.getElementById('converter-enhance-score-note'),
      previewToggle: document.getElementById('converter-preview-toggle'),
      previewStop: document.getElementById('converter-preview-stop'),
      renderButton: document.getElementById('converter-render-button'),
      downloadButton: document.getElementById('converter-download-button'),
      clearRender: document.getElementById('converter-clear-render'),
      formatSelect: document.getElementById('converter-format-select'),
      bitrateSelect: document.getElementById('converter-bitrate-select'),
      samplerateSelect: document.getElementById('converter-samplerate-select'),
      formatNote: document.getElementById('converter-format-note'),
      renderState: document.getElementById('converter-render-state'),
      renderStateText: document.getElementById('converter-render-state-text'),
      renderStatus: document.getElementById('converter-render-status'),
      cleanupTimer: document.getElementById('converter-cleanup-timer'),
      cleanupState: document.getElementById('converter-cleanup-state'),
      analysisSummary: document.getElementById('converter-analysis-summary'),
      waveform: document.getElementById('converter-waveform'),
      spectrum: document.getElementById('converter-spectrum'),
      cloudForm: document.getElementById('converter-cloud-auth-form'),
      cloudHandle: document.getElementById('converter-cloud-handle'),
      cloudPassword: document.getElementById('converter-cloud-password'),
      cloudRegister: document.getElementById('converter-cloud-register'),
      cloudLogout: document.getElementById('converter-cloud-logout'),
      cloudAccount: document.getElementById('converter-cloud-account'),
      cloudSave: document.getElementById('converter-cloud-save'),
      cloudLoad: document.getElementById('converter-cloud-load'),
      cloudStatus: document.getElementById('converter-cloud-status')
    };

    const controlKeys = [
      'converter-eq-low',
      'converter-eq-mid',
      'converter-eq-high',
      'converter-comp-threshold',
      'converter-comp-ratio',
      'converter-limiter-ceiling',
      'converter-stereo-width',
      'converter-target-lufs'
    ];

    const controlRanges = {
      'converter-eq-low': { min: -12, max: 12, step: 0.5 },
      'converter-eq-mid': { min: -12, max: 12, step: 0.5 },
      'converter-eq-high': { min: -12, max: 12, step: 0.5 },
      'converter-comp-threshold': { min: -36, max: 0, step: 1 },
      'converter-comp-ratio': { min: 1, max: 8, step: 0.1 },
      'converter-limiter-ceiling': { min: -6, max: 0, step: 0.1 },
      'converter-stereo-width': { min: 0, max: 200, step: 1 },
      'converter-target-lufs': { min: -18, max: -8, step: 0.5 }
    };

    const controls = Object.fromEntries(controlKeys.map((id) => [id, document.getElementById(id)]));
    const outputs = Object.fromEntries(controlKeys.map((id) => [id + '-value', document.getElementById(id + '-value')]));
    const listeners = [];
    let audioContext = null;
    let loadedFile = null;
    let loadedBuffer = null;
    let sourceProfile = null;
    let sourceLevels = null;
    let sourceLevelsBuffer = null;
    let artifactCleaner = null;
    let enhanceSnapshot = null;
    let enhanceState = 'idle';
    let appliedEnhancement = null;
    const findingsCache = { profile: null, markup: null };
    let previewSource = null;
    let previewAnalyser = null;
    let previewStartAt = 0;
    let previewOffset = 0;
    let previewAnimationFrame = 0;
    let cleanupTimeout = 0;
    let cleanupInterval = 0;
    let renderedAsset = null;
    let isPreviewStopping = false;
    let importGeneration = 0;
    let cloudHandle = '';
    let cloudPending = false;

    function bind(target, type, listener, options) {
      if (!target || typeof target.addEventListener !== 'function') {
        return;
      }
      target.addEventListener(type, listener, options);
      listeners.push(() => target.removeEventListener(type, listener, options));
    }

    function init() {
      syncExportFormatOptions();
      restoreEnhancePreferences();
      updateControlOutputs();
      drawWaveformIdle();
      drawSpectrumIdle();
      updateButtons();
      renderEnhancePanel();
      renderCloudPanel();
      refreshCloudSession();

      bind(elements.browseButton, 'click', () => {
        if (elements.fileInput) {
          elements.fileInput.click();
        }
      });
      bind(elements.fileInput, 'change', () => handleSelectedFiles(elements.fileInput.files));
      bind(elements.resetButton, 'click', resetStudio);
      bind(elements.autoEnhance, 'click', () => applyAutoEnhance({ trigger: 'manual' }));
      bind(elements.autoEnhanceUndo, 'click', undoAutoEnhance);
      bind(elements.autoEnhanceToggle, 'change', () => {
        storeEnhancePreferences();
        renderEnhancePanel();
      });
      bind(elements.autoEnhanceStrength, 'change', () => {
        storeEnhancePreferences();
        if (loadedBuffer && isAutoEnhanceEnabled()) {
          applyAutoEnhance({ trigger: 'strength' });
        } else {
          renderEnhancePanel();
        }
      });
      bind(elements.previewToggle, 'click', togglePreview);
      bind(elements.previewStop, 'click', () => stopPreview(true));
      bind(elements.renderButton, 'click', renderMaster);
      bind(elements.downloadButton, 'click', downloadRenderedFile);
      bind(elements.clearRender, 'click', () => clearRenderedAsset('Temporäre Master-Datei manuell aus dem Speicher gelöscht.'));
      bind(elements.cloudForm, 'submit', (event) => {
        event.preventDefault();
        return authenticateCloud('login');
      });
      bind(elements.cloudRegister, 'click', () => authenticateCloud('register'));
      bind(elements.cloudLogout, 'click', logoutCloud);
      bind(elements.cloudSave, 'click', saveCloudPreset);
      bind(elements.cloudLoad, 'click', loadCloudPreset);
      bind(window, 'resize', handleResize);

      bind(elements.dropzone, 'dragenter', (event) => {
        event.preventDefault();
        elements.dropzone.classList.add('is-dragover');
      });
      bind(elements.dropzone, 'dragover', (event) => {
        event.preventDefault();
        elements.dropzone.classList.add('is-dragover');
      });
      bind(elements.dropzone, 'dragleave', () => elements.dropzone.classList.remove('is-dragover'));
      bind(elements.dropzone, 'drop', (event) => {
        event.preventDefault();
        elements.dropzone.classList.remove('is-dragover');
        handleSelectedFiles(event.dataTransfer && event.dataTransfer.files);
      });
      bind(elements.dropzone, 'keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          elements.fileInput.click();
        }
      });

      Object.values(controls).forEach((control) => {
        bind(control, 'input', () => {
          updateControlOutputs();
          if (enhanceState === 'applied') {
            enhanceState = 'manual';
            renderEnhancePanel();
          }
          if (loadedBuffer) {
            elements.renderStatus.textContent = 'Regler aktualisiert. Preview neu starten oder direkt neu rendern.';
          }
        });
      });

      bind(elements.formatSelect, 'change', updateFormatNote);
      bind(window, 'focus', syncExportFormatOptions);
      bind(window, 'pageshow', syncExportFormatOptions);
      updateFormatNote();
    }

    function handleResize() {
      if (loadedBuffer) {
        drawWaveform(loadedBuffer);
      } else {
        drawWaveformIdle();
      }
      if (!previewSource) {
        drawSpectrumIdle();
      }
    }

    function syncExportFormatOptions() {
      if (!elements.formatSelect) {
        return;
      }

      const selectedValue = elements.formatSelect.value;
      const options = getExportFormats();
      const nextValue = options.some((option) => option.id === selectedValue)
        ? selectedValue
        : ((options[0] && options[0].id) || '');
      elements.formatSelect.innerHTML = options.map((option, index) => (
        '<option value="' + escapeHtml(option.id) + '"' + (option.id === nextValue || (!nextValue && index === 0) ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>'
      )).join('');
      elements.formatSelect.value = nextValue;
      updateFormatNote();
    }

    function updateFormatNote() {
      const selected = getSelectedFormat();
      if (!selected || !elements.formatNote) {
        return;
      }
      elements.bitrateSelect.disabled = selected.id === 'wav';
      if (selected.id !== 'wav') {
        elements.bitrateSelect.value = getDefaultBitrateForFormat(selected);
      }
      elements.formatNote.textContent = getFormatNoteText(selected, getMp3Support());
    }

    function getExportFormats() {
      const mp3Support = getMp3Support();
      const formats = [
        {
          id: 'wav',
          label: 'WAV · verlustfrei',
          extension: 'wav',
          mimeType: 'audio/wav',
          description: 'WAV wird lokal als PCM exportiert und steht unabhängig vom Browser-Codec immer verlustfrei zur Verfügung.',
          approximate: false
        }
      ];

      if (mp3Support.available) {
        formats.push(buildMp3Format(mp3Support));
      }

      if (!canRecordCompressedAudio()) {
        return formats;
      }

      BROWSER_DEPENDENT_EXPORT_FORMATS.forEach((candidate) => {
        if (resolveSupportedMimeType([candidate.mimeType])) {
          formats.push(candidate);
        }
      });

      return formats;
    }

    function getSelectedFormat() {
      const formats = getExportFormats();
      return formats.find((format) => format.id === elements.formatSelect.value) || formats[0];
    }

    async function handleSelectedFiles(fileList) {
      const file = fileList && fileList[0];
      if (!file) {
        return;
      }

      importGeneration += 1;
      const generation = importGeneration;
      await resetPlaybackOnly();
      if (generation !== importGeneration) return;
      clearRenderedAsset('Vorherige temporäre Master-Datei entfernt, weil eine neue Quelldatei geladen wurde.');
      loadedFile = file;
      setRenderState('loading', 'Datei wird lokal dekodiert …');
      elements.importStatus.textContent = 'Datei wird lokal verarbeitet. Es findet kein Upload statt.';
      try {
        const context = await ensureAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await decodeAudioBuffer(context, arrayBuffer);
        if (generation !== importGeneration) return;
        loadedBuffer = buffer;
        sourceProfile = analyzeLoadedSource();
        artifactCleaner = null;
        appliedEnhancement = null;
        enhanceSnapshot = null;
        enhanceState = 'idle';
        previewOffset = 0;
        updateMetadata(file, loadedBuffer);
        updateButtons();
        drawWaveform(loadedBuffer);
        updateAnalysisSummary();
        setRenderState('ready', 'Datei bereit – Preview und Render sind lokal verfügbar.');
        elements.importStatus.textContent = 'Datei erfolgreich lokal geladen. Alle Mastering-Schritte bleiben im Browser.';
        if (isAutoEnhanceEnabled()) {
          applyAutoEnhance({ trigger: 'import' });
        } else {
          renderEnhancePanel();
        }
      } catch (error) {
        if (generation !== importGeneration) return;
        loadedBuffer = null;
        sourceProfile = null;
        artifactCleaner = null;
        appliedEnhancement = null;
        enhanceSnapshot = null;
        enhanceState = 'idle';
        updateButtons();
        renderEnhancePanel();
        drawWaveformIdle();
        setRenderState('error', 'Datei konnte lokal nicht dekodiert werden.');
        elements.importStatus.textContent = 'Die Datei konnte im aktuellen Browser nicht dekodiert werden. Bitte ein unterstütztes Audioformat testen.';
      }
    }

    async function ensureAudioContext() {
      if (audioContext && audioContext.state !== 'closed') {
        return audioContext;
      }
      const ContextCtor = window.AudioContext || window.webkitAudioContext;
      if (typeof ContextCtor !== 'function') {
        throw new Error('Web Audio API nicht verfügbar');
      }
      audioContext = new ContextCtor();
      return audioContext;
    }

    function decodeAudioBuffer(context, arrayBuffer) {
      return new Promise((resolve, reject) => {
        const clonedBuffer = arrayBuffer.slice(0);
        context.decodeAudioData(clonedBuffer, resolve, reject);
      });
    }

    function updateMetadata(file, buffer) {
      elements.fileName.textContent = file.name || 'Lokale Datei';
      elements.fileDuration.textContent = formatDuration(buffer.duration);
      elements.fileRate.textContent = buffer.sampleRate ? (buffer.sampleRate / 1000).toFixed(1) + ' kHz' : '–';
      elements.fileSize.textContent = formatBytes(file.size);
      elements.fileFormat.textContent = describeFormat(file);
      elements.fileChannels.textContent = String(buffer.numberOfChannels || 1);
    }

    function updateButtons() {
      const hasBuffer = Boolean(loadedBuffer);
      elements.resetButton.disabled = !hasBuffer;
      elements.autoEnhance.disabled = !hasBuffer;
      elements.previewToggle.disabled = !hasBuffer;
      elements.previewStop.disabled = !hasBuffer;
      elements.renderButton.disabled = !hasBuffer;
      elements.downloadButton.disabled = !renderedAsset;
      elements.clearRender.disabled = !renderedAsset;
      if (elements.autoEnhanceUndo) {
        elements.autoEnhanceUndo.disabled = !enhanceSnapshot || enhanceState !== 'applied';
      }
      if (elements.autoEnhance) {
        elements.autoEnhance.textContent = enhanceState === 'applied'
          ? 'Qualität erneut analysieren'
          : 'Qualität automatisch verbessern';
      }
    }

    function updateControlOutputs() {
      const formatters = {
        'converter-eq-low': (value) => signedDb(value),
        'converter-eq-mid': (value) => signedDb(value),
        'converter-eq-high': (value) => signedDb(value),
        'converter-comp-threshold': (value) => signedDb(value),
        'converter-comp-ratio': (value) => Number(value).toFixed(1) + ':1',
        'converter-limiter-ceiling': (value) => Number(value).toFixed(1) + ' dBFS',
        'converter-stereo-width': (value) => Math.round(Number(value)) + ' %',
        'converter-target-lufs': (value) => Number(value).toFixed(1).replace('.0', '') + ' LUFS approx.'
      };

      Object.keys(controls).forEach((key) => {
        const control = controls[key];
        const output = outputs[key + '-value'];
        if (!control || !output) {
          return;
        }
        const formatter = formatters[key] || ((value) => String(value));
        output.textContent = formatter(control.value);
      });
    }

    function readSettings() {
      return {
        eqLow: Number(controls['converter-eq-low'].value),
        eqMid: Number(controls['converter-eq-mid'].value),
        eqHigh: Number(controls['converter-eq-high'].value),
        compThreshold: Number(controls['converter-comp-threshold'].value),
        compRatio: Number(controls['converter-comp-ratio'].value),
        limiterCeiling: Number(controls['converter-limiter-ceiling'].value),
        stereoWidth: Number(controls['converter-stereo-width'].value),
        targetLufs: Number(controls['converter-target-lufs'].value),
        artifactCleaner
      };
    }

    const ENHANCE_CONTROL_NAMES = {
      eqLow: 'converter-eq-low', eqMid: 'converter-eq-mid', eqHigh: 'converter-eq-high',
      compThreshold: 'converter-comp-threshold', compRatio: 'converter-comp-ratio',
      limiterCeiling: 'converter-limiter-ceiling', stereoWidth: 'converter-stereo-width',
      targetLufs: 'converter-target-lufs'
    };

    // Above "ausgewogen" the extra push is gated by the source quality in the
    // core, so even "maximal" stays restrained on already clean material.
    const ENHANCE_STRENGTHS = {
      subtle: { factor: 0.35, label: 'dezent', hint: 'Nur Feinschliff – die Quelle bleibt nahezu unverändert.' },
      gentle: { factor: 0.6, label: 'sanft', hint: 'Behutsame Korrektur mit minimalen Eingriffen.' },
      balanced: { factor: 1, label: 'ausgewogen', hint: 'Empfohlen – deutliche, aber natürliche Verbesserung.' },
      strong: { factor: 1.4, label: 'kräftig', hint: 'Deutlich hörbare Korrektur für Quellen mit sichtbaren Schwächen.' },
      intense: { factor: 1.75, label: 'intensiv', hint: 'Sehr starke Korrektur für schwache Quellen – saubere Quellen bleiben geschont.' },
      maximum: { factor: 2.1, label: 'maximal', hint: 'Stärkste Rettung für schlechte Quellen: tiefe Artefakt-Reinigung, Kanalausgleich und volle Korrektur.' }
    };

    function isAutoEnhanceEnabled() {
      return elements.autoEnhanceToggle ? Boolean(elements.autoEnhanceToggle.checked) : true;
    }

    function getEnhanceStrength() {
      const key = (elements.autoEnhanceStrength && elements.autoEnhanceStrength.value) || 'balanced';
      return ENHANCE_STRENGTHS[key] || ENHANCE_STRENGTHS.balanced;
    }

    function snapControlValue(controlId, value) {
      const range = controlRanges[controlId];
      const numeric = Number(value);
      if (!range || !Number.isFinite(numeric)) {
        return numeric;
      }
      const snapped = Math.round(numeric / range.step) * range.step;
      const bounded = Math.max(range.min, Math.min(range.max, snapped));
      return Number(bounded.toFixed(2));
    }

    function readControlSnapshot() {
      return Object.fromEntries(Object.values(ENHANCE_CONTROL_NAMES)
        .filter((id) => controls[id])
        .map((id) => [id, controls[id].value]));
    }

    function applyControlSnapshot(snapshot) {
      Object.keys(snapshot || {}).forEach((id) => {
        if (controls[id]) {
          controls[id].value = snapshot[id];
        }
      });
    }

    function readEnhancePreferences() {
      try {
        const raw = window.localStorage && window.localStorage.getItem(ENHANCE_PREFERENCES_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }

    function restoreEnhancePreferences() {
      const stored = readEnhancePreferences();
      if (!stored) {
        return;
      }
      if (elements.autoEnhanceToggle && typeof stored.auto === 'boolean') {
        elements.autoEnhanceToggle.checked = stored.auto;
      }
      if (elements.autoEnhanceStrength && ENHANCE_STRENGTHS[stored.strength]) {
        elements.autoEnhanceStrength.value = stored.strength;
      }
    }

    function storeEnhancePreferences() {
      try {
        if (!window.localStorage) {
          return;
        }
        window.localStorage.setItem(ENHANCE_PREFERENCES_KEY, JSON.stringify({
          auto: isAutoEnhanceEnabled(),
          strength: (elements.autoEnhanceStrength && elements.autoEnhanceStrength.value) || 'balanced'
        }));
      } catch (error) {
        /* Komfortspeicher ist optional. */
      }
    }

    function analyzeLoadedSource() {
      try {
        return core.analyzeSource(loadedBuffer);
      } catch (error) {
        return null;
      }
    }

    function applyAutoEnhance(options) {
      if (!loadedBuffer) {
        return;
      }
      const trigger = (options && options.trigger) || 'manual';
      const strength = getEnhanceStrength();
      let settings;
      try {
        // The source profile and its assessment are cached, so re-applying or
        // changing the strength never re-scans the audio buffer.
        settings = core.chooseEnhancement(sourceProfile, { strength: strength.factor });
      } catch (error) {
        settings = {
          eqLow: 1.5, eqMid: 2.5, eqHigh: 2, compThreshold: -20,
          compRatio: 3.2, limiterCeiling: -1, stereoWidth: 118, targetLufs: -12,
          artifactCleaner: null
        };
      }
      if (enhanceState !== 'applied') {
        enhanceSnapshot = readControlSnapshot();
      }
      Object.keys(ENHANCE_CONTROL_NAMES).forEach((key) => {
        const controlId = ENHANCE_CONTROL_NAMES[key];
        if (controls[controlId]) {
          controls[controlId].value = String(snapControlValue(controlId, settings[key]));
        }
      });
      artifactCleaner = settings.artifactCleaner;
      appliedEnhancement = { ...readSettings(), insight: settings.insight || null };
      enhanceState = 'applied';
      updateControlOutputs();
      elements.renderStatus.textContent = sourceProfile
        ? 'Auto-Enhance quellenabhängig gesetzt' + (artifactCleaner ? ' · Artefakt-Reinigung aktiv.' : '.')
        : 'Analyse nicht verfügbar: klassisches Auto-Enhance-Preset gesetzt.';
      renderEnhancePanel({ trigger, strength });
    }

    function undoAutoEnhance() {
      if (!enhanceSnapshot) {
        return;
      }
      applyControlSnapshot(enhanceSnapshot);
      enhanceSnapshot = null;
      artifactCleaner = null;
      appliedEnhancement = null;
      enhanceState = 'reverted';
      updateControlOutputs();
      elements.renderStatus.textContent = 'Auto-Enhance zurückgenommen. Die Regler stehen wieder auf den vorherigen Werten.';
      renderEnhancePanel();
    }

    function renderEnhancePanel(context) {
      updateButtons();
      const strength = (context && context.strength) || getEnhanceStrength();
      const trigger = context && context.trigger;
      if (elements.enhanceScore || elements.enhanceScoreBar || elements.enhanceScoreNote) {
        const score = loadedBuffer ? core.scoreProfile(sourceProfile) : null;
        if (elements.enhanceScore) {
          elements.enhanceScore.textContent = Number.isFinite(score) ? String(score) : '–';
        }
        if (elements.enhanceScoreBar) {
          elements.enhanceScoreBar.style.width = (Number.isFinite(score) ? score : 0) + '%';
          if (elements.enhanceScoreBar.parentElement && elements.enhanceScoreBar.parentElement.dataset) {
            elements.enhanceScoreBar.parentElement.dataset.tone = describeScoreTone(score);
          }
          elements.enhanceScoreBar.setAttribute('aria-valuenow', Number.isFinite(score) ? String(score) : '0');
        }
        if (elements.enhanceScoreNote) {
          elements.enhanceScoreNote.textContent = !loadedBuffer
            ? 'Der Qualitäts-Check startet automatisch, sobald du eine Datei lädst.'
            : (Number.isFinite(score)
              ? describeScoreNote(score) + describeProjection()
              : 'Die Quelle liess sich nicht vollständig vermessen. Es greift ein neutrales Standard-Preset.');
        }
      }

      if (elements.autoEnhanceStrengthHint) {
        elements.autoEnhanceStrengthHint.textContent = 'Stärke „' + strength.label + '“: ' + strength.hint;
      }

      if (elements.enhanceFindings) {
        elements.enhanceFindings.innerHTML = loadedBuffer
          ? getFindingsMarkup()
          : '<li class="enhance-finding" data-tone="idle"><strong>Noch keine Analyse</strong><span>Lade eine Datei, dann prüft das Studio Clipping, Dynamik, Höhen, Stereobild, Kanalbalance und Lautheit automatisch.</span></li>';
      }

      if (elements.enhanceSteps) {
        const steps = enhanceState === 'applied' ? core.summarizeEnhancement(appliedEnhancement) : [];
        elements.enhanceSteps.innerHTML = steps.length
          ? steps.map((step) => '<li>' + escapeHtml(step) + '</li>').join('')
          : '<li class="is-placeholder">Noch keine automatische Korrektur angewendet. Die Regler bleiben unverändert, bis du Auto-Enhance startest.</li>';
      }

      if (elements.enhanceStatus) {
        elements.enhanceStatus.textContent = buildEnhanceStatusText(trigger, strength);
      }
    }

    // Findings only depend on the source profile, so the markup is built once
    // per import and reused for strength changes, re-applies and undo.
    function getFindingsMarkup() {
      if (findingsCache.profile !== sourceProfile || findingsCache.markup === null) {
        findingsCache.profile = sourceProfile;
        findingsCache.markup = core.describeProfile(sourceProfile).map((finding) => (
          '<li class="enhance-finding" data-tone="' + escapeHtml(finding.tone) + '">'
          + '<strong>' + escapeHtml(finding.label) + '</strong>'
          + '<span>' + escapeHtml(finding.detail) + '</span>'
          + '</li>'
        )).join('');
      }
      return findingsCache.markup;
    }

    function buildEnhanceStatusText(trigger, strength) {
      if (!loadedBuffer) {
        return isAutoEnhanceEnabled()
          ? 'Automatik ist aktiv: Direkt nach dem Laden wird die Quelle analysiert und die Verbesserung in Stärke „' + strength.label + '“ angewendet.'
          : 'Automatik ist deaktiviert: Du startest die Verbesserung nach dem Laden manuell über „Qualität automatisch verbessern“.';
      }
      if (enhanceState === 'applied') {
        const origin = trigger === 'import'
          ? 'Automatisch nach dem Import angewendet'
          : (trigger === 'strength' ? 'Mit neuer Stärke neu berechnet' : 'Manuell angewendet');
        return origin + ' · Stärke „' + strength.label + '“'
          + (sourceProfile ? ' · auf Basis der Quellenanalyse.' : ' · neutrales Standard-Preset, weil keine Analyse möglich war.')
          + ' Mit „Rückgängig“ stellst du die vorherigen Reglerwerte wieder her.';
      }
      if (enhanceState === 'manual') {
        return 'Regler manuell angepasst. Die automatische Verbesserung kann jederzeit erneut angewendet werden.';
      }
      if (enhanceState === 'reverted') {
        return 'Automatische Verbesserung zurückgenommen. Die Regler entsprechen wieder dem Stand vor Auto-Enhance.';
      }
      return 'Analyse abgeschlossen. Starte die automatische Verbesserung oder justiere die Regler manuell.';
    }

    function describeScoreTone(score) {
      if (!Number.isFinite(score)) {
        return 'idle';
      }
      if (score >= 80) {
        return 'good';
      }
      return score >= 55 ? 'warn' : 'alert';
    }

    function describeProjection() {
      const insight = enhanceState === 'applied' && appliedEnhancement && appliedEnhancement.insight;
      if (!insight || !Number.isFinite(insight.projectedScore)) {
        return '';
      }
      const gain = insight.projectedScore - insight.score;
      return ' Prognose nach Auto-Enhance: approx. ' + insight.projectedScore + (gain > 0 ? ' (+' + gain + ')' : '') + '.';
    }

    function describeScoreNote(score) {
      if (score >= 80) {
        return 'Die Quelle ist bereits sauber. Auto-Enhance arbeitet entsprechend zurückhaltend.';
      }
      if (score >= 55) {
        return 'Die Quelle zeigt hörbare Schwächen. Auto-Enhance korrigiert gezielt die markierten Punkte.';
      }
      return 'Die Quelle hat deutliche Probleme. Auto-Enhance greift stärker ein und aktiviert die Artefakt-Reinigung.';
    }

    async function togglePreview() {
      if (!loadedBuffer) {
        return;
      }
      if (previewSource) {
        pausePreview();
        return;
      }
      await startPreview(previewOffset || 0);
    }

    async function startPreview(offsetSeconds) {
      const context = await ensureAudioContext();
      if (context.state === 'suspended') {
        await context.resume();
      }

      const source = context.createBufferSource();
      source.buffer = loadedBuffer;
      const analyser = context.createAnalyser();
      analyser.fftSize = spectrumFftSize;
      analyser.smoothingTimeConstant = 0.82;
      const chain = core.createPreviewChain(context, readSettings(), analyser, loadedBuffer.numberOfChannels);
      chain.output.connect(context.destination);
      source.connect(chain.input);
      source.start(0, Math.max(0, offsetSeconds));
      previewSource = source;
      previewAnalyser = analyser;
      previewStartAt = context.currentTime - Math.max(0, offsetSeconds);
      elements.previewToggle.textContent = 'Preview pausieren';
      elements.renderStatus.textContent = 'Preview läuft lokal durch die aktuelle Mastering-Kette.';
      startSpectrumLoop();
      source.onended = () => {
        if (isPreviewStopping) {
          isPreviewStopping = false;
          return;
        }
        previewOffset = 0;
        cleanupPreviewState();
        drawSpectrumIdle();
        elements.renderStatus.textContent = 'Preview beendet. Du kannst erneut starten oder jetzt rendern.';
      };
    }

    function pausePreview() {
      if (!previewSource || !audioContext) {
        return;
      }
      previewOffset = Math.max(0, audioContext.currentTime - previewStartAt);
      isPreviewStopping = true;
      previewSource.stop();
      cleanupPreviewState();
      drawSpectrumIdle();
      elements.renderStatus.textContent = 'Preview pausiert. Der Wiedereinstieg startet an der letzten Position.';
    }

    function stopPreview(resetOffset) {
      if (previewSource) {
        isPreviewStopping = true;
        previewSource.stop();
      }
      if (resetOffset) {
        previewOffset = 0;
      }
      cleanupPreviewState();
      drawSpectrumIdle();
      elements.renderStatus.textContent = resetOffset
        ? 'Preview gestoppt. Der nächste Start beginnt wieder am Anfang.'
        : 'Preview gestoppt.';
    }

    async function resetPlaybackOnly() {
      stopPreview(true);
    }

    function cleanupPreviewState() {
      if (previewAnimationFrame) {
        cancelAnimationFrame(previewAnimationFrame);
        previewAnimationFrame = 0;
      }
      previewSource = null;
      previewAnalyser = null;
      elements.previewToggle.textContent = 'Preview starten';
    }

    function startSpectrumLoop() {
      if (!elements.spectrum || !previewAnalyser) {
        return;
      }
      const canvas = elements.spectrum;
      const context = canvas.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, Math.floor(canvas.clientWidth || canvas.width / ratio));
      const height = Math.max(160, Math.floor(canvas.clientHeight || canvas.height / ratio));
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const data = new Uint8Array(previewAnalyser.frequencyBinCount);

      const frame = () => {
        if (!previewAnalyser) {
          return;
        }
        previewAnalyser.getByteFrequencyData(data);
        context.clearRect(0, 0, width, height);
        paintCanvasBackground(context, width, height);
        const barWidth = width / data.length;
        for (let index = 0; index < data.length; index += 1) {
          const magnitude = data[index] / 255;
          const barHeight = Math.max(2, magnitude * (height - 22));
          context.fillStyle = 'rgba(77, 220, 255, ' + Math.max(0.18, magnitude).toFixed(3) + ')';
          context.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth * 0.85), barHeight);
        }
        context.fillStyle = 'rgba(183, 199, 221, 0.82)';
        context.font = '12px sans-serif';
        context.fillText('Realtime Spectrum · Preview', 12, 18);
        previewAnimationFrame = requestAnimationFrame(frame);
      };

      frame();
    }

    async function renderMaster() {
      if (!loadedBuffer) {
        return;
      }
      syncExportFormatOptions();
      const exportFormat = getSelectedFormat();
      const mp3Support = exportFormat.id === 'mp3' ? getMp3Support() : null;
      setRenderState('loading', 'Master wird lokal gerendert …');
      elements.renderStatus.textContent = exportFormat.id === 'mp3' && mp3Support && mp3Support.clientEncoder && !mp3Support.nativeMimeType
        ? 'Offline-Render läuft lokal im Browser. MP3 wird direkt mit dem integrierten lokalen Encoder erzeugt.'
        : (exportFormat.id === 'mp3' && mp3Support && mp3Support.serverEndpoint && !mp3Support.nativeMimeType && !mp3Support.clientEncoder
          ? 'Offline-Render läuft lokal im Browser. Die fertige WAV-Datei wird danach an den konfigurierten Same-Origin-Konverter für MP3 übergeben.'
          : 'Offline-Render läuft lokal im Browser. Keine Daten verlassen dieses Gerät.');
      elements.renderButton.disabled = true;
      try {
        const sampleRateValue = elements.samplerateSelect.value === 'source'
          ? loadedBuffer.sampleRate
          : Number(elements.samplerateSelect.value);
        const rendered = await core.render(loadedBuffer, readSettings(), sampleRateValue);
        const bitrate = Number(elements.bitrateSelect.value) || Number(getDefaultBitrateForFormat(exportFormat)) || 192000;
        const masteredBuffer = rendered.buffer;
        const blob = exportFormat.id === 'wav'
          ? core.encodeWav(masteredBuffer)
          : exportFormat.id === 'mp3'
            ? await renderMp3Export(masteredBuffer, bitrate)
          : await recordCompressedExport(masteredBuffer, exportFormat, bitrate);

        storeRenderedAsset({
          blob,
          filename: buildRenderedFilename(loadedFile, exportFormat),
          report: rendered.report,
          format: exportFormat,
          sampleRate: rendered.buffer.sampleRate
        });
        setRenderState('playing', 'Master-Datei bereit – Cleanup-Timer aktiv.');
        elements.renderStatus.textContent = 'Render erfolgreich. Die temporäre Master-Datei wird maximal 2:00 lokal im Speicher gehalten.';
      } catch (error) {
        setRenderState('error', 'Render fehlgeschlagen.');
        elements.renderStatus.textContent = error && error.message
          ? error.message
          : 'Der lokale Render ist fehlgeschlagen. Bitte Einstellungen reduzieren oder anderes Zielformat testen.';
      } finally {
        elements.renderButton.disabled = !loadedBuffer;
      }
    }

    async function recordCompressedExport(masteredBuffer, format, bitrate) {
      if (typeof MediaRecorder !== 'function') {
        throw new Error('Für dieses Zielformat steht kein Browser-Encoder zur Verfügung.');
      }
      if (!isMimeTypeSupported(format && format.mimeType)) {
        throw new Error(
          format && format.id === 'mp3'
            ? 'MP3-Export ist in diesem Browser nicht nativ verfügbar. Bitte WAV oder eine angebotene Browser-Option verwenden.'
            : 'Für dieses Zielformat steht im aktuellen Browser kein nativer Encoder bereit. Bitte WAV oder ein anderes angebotenes Format verwenden.'
        );
      }
      const exportContext = createRealtimeAudioContext(masteredBuffer.sampleRate);
      const source = exportContext.createBufferSource();
      source.buffer = masteredBuffer;
      const destination = exportContext.createMediaStreamDestination();
      source.connect(destination);
      const chunks = [];
      const recorder = new MediaRecorder(destination.stream, {
        mimeType: format.mimeType,
        audioBitsPerSecond: bitrate
      });

      return new Promise((resolve, reject) => {
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data && event.data.size) {
            chunks.push(event.data);
          }
        });
        recorder.addEventListener('error', async () => {
          await closeAudioContextQuietly(exportContext);
          reject(new Error('Browser-Encoder hat den lokalen Export abgebrochen.'));
        });
        recorder.addEventListener('stop', async () => {
          try {
            await exportContext.close();
          } catch (error) {
            reject(new Error('Browser-Encoder konnte den lokalen Export-Kontext nicht sauber schließen.'));
            return;
          }
          resolve(new Blob(chunks, { type: format.mimeType }));
        }, { once: true });

        source.addEventListener('ended', () => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }, { once: true });

        exportContext.resume().then(() => {
          try {
            recorder.start();
            source.start(0);
          } catch (error) {
            closeAudioContextQuietly(exportContext).then(() => {
              reject(new Error('Browser konnte den lokalen Encoder nicht starten.'));
            });
          }
        }).catch(async () => {
          try {
            await exportContext.close();
          } catch (error) {
            reject(new Error('Browser konnte den lokalen Encoder nicht starten und den Audio-Kontext nicht sauber schließen.'));
            return;
          }
          reject(new Error('Browser konnte den lokalen Encoder nicht starten.'));
        });
      });
    }

    async function renderMp3Export(masteredBuffer, bitrate) {
      const mp3Support = getMp3Support();
      if (mp3Support.nativeMimeType) {
        return recordCompressedExport(masteredBuffer, buildMp3Format(mp3Support), bitrate);
      }

      if (mp3Support.clientEncoder) {
        return encodeMp3Locally(masteredBuffer, bitrate, mp3Support.clientEncoder);
      }

      if (mp3Support.serverEndpoint) {
        return requestServerMp3Conversion(masteredBuffer, bitrate, mp3Support.serverEndpoint, core.encodeWav(masteredBuffer));
      }

      throw new Error('MP3-Export ist hier nicht verfügbar. Es wird nativer MP3-Support, ein lokaler MP3-Encoder oder ein Same-Origin-Konverter benötigt.');
    }

    function getMp3Support() {
      const nativeMimeType = resolveSupportedMp3MimeType();
      const clientEncoder = getClientMp3Encoder();
      const serverEndpoint = resolveMp3ServerEndpoint();
      return {
        nativeMimeType,
        clientEncoder,
        serverEndpoint,
        available: Boolean(nativeMimeType || clientEncoder || serverEndpoint)
      };
    }

    function buildMp3Format(mp3Support) {
      return {
        id: 'mp3',
        label: 'MP3 · echter Export',
        extension: 'mp3',
        mimeType: (mp3Support && mp3Support.nativeMimeType) || 'audio/mpeg',
        description: buildMp3Description(mp3Support),
        approximate: true
      };
    }

    function buildMp3Description(mp3Support) {
      return 'MP3 ist lokal verfügbar, erzeugt eine echte .mp3-Datei direkt im Browser ohne Upload und nutzt standardmäßig 192 kbps. Verfügbarer Pfad: '
        + buildMp3RouteList(mp3Support) + '.';
    }

    function storeRenderedAsset(asset) {
      clearRenderedAsset('Vorherige temporäre Master-Datei ersetzt.');
      const url = URL.createObjectURL(asset.blob);
      renderedAsset = Object.assign({}, asset, { url, createdAt: Date.now(), expiresAt: Date.now() + CLEANUP_WINDOW_MS });
      updateButtons();
      updateCleanupDisplay();
      updateAnalysisSummary(renderedAsset.report, renderedAsset);
      cleanupTimeout = window.setTimeout(() => {
        clearRenderedAsset('Timer abgelaufen. Die temporäre Master-Datei wurde automatisch aus dem Speicher entfernt.');
      }, CLEANUP_WINDOW_MS);
      cleanupInterval = window.setInterval(updateCleanupDisplay, 1000);
    }

    function updateCleanupDisplay() {
      if (!renderedAsset) {
        elements.cleanupTimer.textContent = '02:00';
        elements.cleanupState.textContent = 'Timer startet erst nach erfolgreichem Render.';
        return;
      }
      const remainingMs = Math.max(0, renderedAsset.expiresAt - Date.now());
      elements.cleanupTimer.textContent = formatTimer(remainingMs);
      elements.cleanupState.textContent = remainingMs > 0
        ? 'Temporäre Master-Datei aktiv. Download oder Timerende löschen die Datei automatisch.'
        : 'Temporäre Master-Datei wird bereinigt …';
    }

    function downloadRenderedFile() {
      if (!renderedAsset) {
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = renderedAsset.url;
      anchor.download = renderedAsset.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => {
        clearRenderedAsset('Download gestartet. Die temporäre Master-Datei wurde direkt danach aus dem Speicher entfernt.');
      }, 250);
    }

    function clearRenderedAsset(message) {
      if (cleanupTimeout) {
        window.clearTimeout(cleanupTimeout);
        cleanupTimeout = 0;
      }
      if (cleanupInterval) {
        window.clearInterval(cleanupInterval);
        cleanupInterval = 0;
      }
      if (renderedAsset && renderedAsset.url) {
        URL.revokeObjectURL(renderedAsset.url);
      }
      renderedAsset = null;
      updateButtons();
      updateCleanupDisplay();
      if (message && elements.renderStatus) {
        elements.renderStatus.textContent = message;
      }
      updateAnalysisSummary();
    }

    function getSourceLevels() {
      if (!loadedBuffer) {
        return null;
      }
      if (sourceLevelsBuffer !== loadedBuffer) {
        // Mono/stereo sources were already fully measured by the quality check.
        sourceLevels = sourceProfile && loadedBuffer.numberOfChannels <= 2
          ? { peak: sourceProfile.peak, rms: sourceProfile.rms, loudnessDb: sourceProfile.loudnessDb }
          : core.analyzeBuffer(loadedBuffer);
        sourceLevelsBuffer = loadedBuffer;
      }
      return sourceLevels;
    }

    function updateAnalysisSummary(renderReport, asset) {
      const sourceAnalysis = getSourceLevels();
      const output = [];
      if (!loadedBuffer) {
        elements.analysisSummary.innerHTML = '<p><strong>Analyse:</strong> Noch keine Datei geladen.</p>';
        return;
      }
      output.push('<p><strong>Quelle:</strong> approx. ' + formatLoudness(sourceAnalysis && sourceAnalysis.loudnessDb) + ' · Peak ' + formatPeak(sourceAnalysis && sourceAnalysis.peak) + '</p>');
      if (sourceProfile) {
        output.push('<p><strong>Quellenprofil:</strong> Bass ' + sourceProfile.bassTiltDb.toFixed(1) + ' dB · Präsenz ' + sourceProfile.presenceTiltDb.toFixed(1) + ' dB · Höhen ' + sourceProfile.trebleTiltDb.toFixed(1) + ' dB · Crest ' + sourceProfile.crestDb.toFixed(1) + ' dB' + (sourceProfile.harshness || sourceProfile.brittle ? ' · harsche Höhen' : '') + (sourceProfile.phasey ? ' · phasiges Stereo' : '') + (sourceProfile.clippingRatio > 0.001 ? ' · Clipping' : '') + '</p>');
      }
      if (renderReport && asset) {
        output.push('<p><strong>Master:</strong> approx. ' + formatLoudness(renderReport.outputApproxLufs) + ' · Peak ' + formatPeak(renderReport.peakAfter) + ' · ' + escapeHtml(asset.filename) + ' · ' + (asset.sampleRate / 1000).toFixed(1) + ' kHz</p>');
      } else {
        output.push('<p><strong>Master:</strong> Noch kein Render vorhanden. Preview und Regler arbeiten weiterhin lokal auf derselben Quelle.</p>');
      }
      elements.analysisSummary.innerHTML = output.join('');
    }

    function setCloudStatus(message, isError) {
      if (!elements.cloudStatus) {
        return;
      }
      elements.cloudStatus.textContent = message;
      if (elements.cloudStatus.classList) {
        elements.cloudStatus.classList.toggle('error', Boolean(isError));
      }
    }

    function renderCloudPanel() {
      const configured = cloudSync.isConfigured();
      const signedIn = configured && Boolean(cloudHandle);
      if (elements.cloudForm) {
        elements.cloudForm.hidden = !configured || signedIn;
      }
      [elements.cloudHandle, elements.cloudPassword, elements.cloudRegister].forEach((control) => {
        if (control) {
          control.disabled = !configured || cloudPending;
        }
      });
      if (elements.cloudLogout) {
        elements.cloudLogout.hidden = !signedIn;
        elements.cloudLogout.disabled = cloudPending;
      }
      if (elements.cloudSave) {
        elements.cloudSave.disabled = !signedIn || cloudPending;
      }
      if (elements.cloudLoad) {
        elements.cloudLoad.disabled = !signedIn || cloudPending;
      }
      if (elements.cloudAccount) {
        elements.cloudAccount.textContent = !configured
          ? 'nicht eingerichtet'
          : (signedIn ? 'angemeldet als ' + cloudHandle : 'nicht angemeldet');
      }
      if (!configured) {
        setCloudStatus(CLOUD_SYNC_MESSAGES.NOT_CONFIGURED, false);
      }
    }

    async function runCloudTask(task) {
      if (!cloudSync.isConfigured() || cloudPending) {
        renderCloudPanel();
        return;
      }
      cloudPending = true;
      renderCloudPanel();
      try {
        await task();
      } catch (error) {
        if (error && error.code === 'SESSION_REQUIRED') {
          cloudHandle = '';
        }
        setCloudStatus((error && error.message) || CLOUD_SYNC_MESSAGES.INTERNAL_ERROR, true);
      } finally {
        cloudPending = false;
        renderCloudPanel();
      }
    }

    function refreshCloudSession() {
      return runCloudTask(async () => {
        try {
          const payload = await cloudSync.session();
          cloudHandle = String(payload.handle || '');
          setCloudStatus('Angemeldet als ' + cloudHandle + '. Presets können jetzt in der Cloud gespeichert und geladen werden.', false);
        } catch (error) {
          if (error && error.code === 'SESSION_REQUIRED') {
            cloudHandle = '';
            setCloudStatus('Cloud-Sync ist verfügbar. Melde dich an, um Studio-Presets zwischen Geräten zu synchronisieren.', false);
            return;
          }
          throw error;
        }
      });
    }

    function authenticateCloud(mode) {
      const handle = elements.cloudHandle ? String(elements.cloudHandle.value || '').trim() : '';
      const password = elements.cloudPassword ? String(elements.cloudPassword.value || '') : '';
      return runCloudTask(async () => {
        const payload = mode === 'register'
          ? await cloudSync.register(handle, password)
          : await cloudSync.login(handle, password);
        cloudHandle = String(payload.handle || handle);
        if (elements.cloudPassword) {
          elements.cloudPassword.value = '';
        }
        setCloudStatus((mode === 'register' ? 'Account erstellt. ' : '') + 'Angemeldet als ' + cloudHandle + '.', false);
      });
    }

    function logoutCloud() {
      return runCloudTask(async () => {
        try {
          await cloudSync.logout();
        } catch (error) {
          if (!error || error.code !== 'SESSION_REQUIRED') {
            throw error;
          }
        }
        cloudHandle = '';
        setCloudStatus('Abgemeldet. Die Sitzung wurde im Cloudflare-Backend beendet.', false);
      });
    }

    function buildCloudPreset() {
      const values = readSettings();
      const settings = {};
      Object.keys(ENHANCE_CONTROL_NAMES).forEach((key) => {
        settings[key] = values[key];
      });
      return {
        settings,
        enhance: {
          auto: isAutoEnhanceEnabled(),
          strength: (elements.autoEnhanceStrength && elements.autoEnhanceStrength.value) || 'balanced'
        }
      };
    }

    function applyCloudPreset(preset) {
      const settings = (preset && preset.settings) || {};
      Object.keys(ENHANCE_CONTROL_NAMES).forEach((key) => {
        const controlId = ENHANCE_CONTROL_NAMES[key];
        const value = snapControlValue(controlId, settings[key]);
        if (controls[controlId] && Number.isFinite(value)) {
          controls[controlId].value = String(value);
        }
      });
      const enhance = (preset && preset.enhance) || {};
      if (elements.autoEnhanceToggle && typeof enhance.auto === 'boolean') {
        elements.autoEnhanceToggle.checked = enhance.auto;
      }
      if (elements.autoEnhanceStrength && ENHANCE_STRENGTHS[enhance.strength]) {
        elements.autoEnhanceStrength.value = enhance.strength;
      }
      storeEnhancePreferences();
      if (enhanceState === 'applied') {
        enhanceState = 'manual';
      }
      enhanceSnapshot = null;
      updateControlOutputs();
      updateButtons();
      renderEnhancePanel();
      if (loadedBuffer && elements.renderStatus) {
        elements.renderStatus.textContent = 'Cloud-Preset übernommen. Preview neu starten oder direkt neu rendern.';
      }
    }

    function saveCloudPreset() {
      return runCloudTask(async () => {
        await cloudSync.savePreset(buildCloudPreset());
        setCloudStatus('Preset in der Cloud gespeichert: Regler und Auto-Enhance-Einstellungen. Audiodateien wurden nicht hochgeladen.', false);
      });
    }

    function loadCloudPreset() {
      return runCloudTask(async () => {
        const payload = await cloudSync.loadPreset();
        if (!payload.preset) {
          setCloudStatus('Für diesen Account ist noch kein Studio-Preset in der Cloud gespeichert.', false);
          return;
        }
        applyCloudPreset(payload.preset);
        setCloudStatus('Cloud-Preset geladen und auf die Regler angewendet.', false);
      });
    }

    function resetStudio() {
      importGeneration += 1;
      stopPreview(true);
      clearRenderedAsset('Temporäre Master-Datei entfernt, weil das Studio zurückgesetzt wurde.');
      loadedFile = null;
      loadedBuffer = null;
      sourceProfile = null;
      artifactCleaner = null;
      appliedEnhancement = null;
      enhanceSnapshot = null;
      enhanceState = 'idle';
      previewOffset = 0;
      if (elements.fileInput) {
        elements.fileInput.value = '';
      }
      ['fileName', 'fileDuration', 'fileRate', 'fileSize', 'fileFormat', 'fileChannels'].forEach((key) => {
        elements[key].textContent = '–';
      });
      updateButtons();
      renderEnhancePanel();
      drawWaveformIdle();
      drawSpectrumIdle();
      updateAnalysisSummary();
      setRenderState('ready', 'Bereit – nach dem Laden einer Datei kann lokal gerendert werden.');
      elements.importStatus.textContent = 'Studio zurückgesetzt. Keine Datei geladen und keine temporäre Master-Datei im Speicher.';
    }

    function drawWaveformIdle() {
      drawIdleCanvas(elements.waveform, 'Waveform wartet auf lokale Audiodatei');
    }

    function drawSpectrumIdle() {
      drawIdleCanvas(elements.spectrum, 'Realtime Spectrum wartet auf Preview');
    }

    function drawWaveform(buffer) {
      const canvas = elements.waveform;
      if (!canvas || !buffer) {
        return;
      }
      const ctx = canvas.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, Math.floor(canvas.clientWidth || canvas.width / ratio));
      const height = Math.max(160, Math.floor(canvas.clientHeight || canvas.height / ratio));
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintCanvasBackground(ctx, width, height);

      const samples = buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(samples.length / width));
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(77, 220, 255, 0.92)';
      ctx.beginPath();
      for (let x = 0; x < width; x += 1) {
        const start = x * step;
        let min = 1;
        let max = -1;
        for (let index = 0; index < step && (start + index) < samples.length; index += 1) {
          const sample = samples[start + index];
          if (sample < min) {
            min = sample;
          }
          if (sample > max) {
            max = sample;
          }
        }
        const y1 = (1 + min) * 0.5 * height;
        const y2 = (1 + max) * 0.5 * height;
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(183, 199, 221, 0.82)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Waveform · lokale Quelle', 12, 18);
    }

    function drawIdleCanvas(canvas, label) {
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, Math.floor(canvas.clientWidth || canvas.width / ratio));
      const height = Math.max(160, Math.floor(canvas.clientHeight || canvas.height / ratio));
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintCanvasBackground(ctx, width, height);
      ctx.strokeStyle = 'rgba(77, 220, 255, 0.18)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(183, 199, 221, 0.82)';
      ctx.font = '12px sans-serif';
      ctx.fillText(label, 12, 18);
    }

    function paintCanvasBackground(ctx, width, height) {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, 'rgba(12, 19, 34, 0.96)');
      gradient.addColorStop(1, 'rgba(5, 11, 21, 0.98)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(77, 220, 255, 0.08)';
      for (let x = 0; x < width; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    function setRenderState(state, text) {
      if (elements.renderState && elements.renderState.dataset) {
        elements.renderState.dataset.state = state;
      }
      if (elements.renderStateText) {
        elements.renderStateText.textContent = text;
      }
      if (elements.renderState) {
        elements.renderState.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
      }
    }

    function destroyStudio() {
      importGeneration += 1;
      stopPreview(true);
      clearRenderedAsset('Temporäre Master-Datei bei Seitenwechsel bereinigt.');
      sourceProfile = null;
      artifactCleaner = null;
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => null);
      }
      audioContext = null;
      while (listeners.length) {
        const cleanup = listeners.pop();
        cleanup();
      }
    }

    return {
      init,
      destroy: destroyStudio,
      _seedRenderedAssetForTest(asset) {
        storeRenderedAsset(asset);
      },
      _hasRenderedAssetForTest() {
        return Boolean(renderedAsset);
      },
      _downloadRenderedFileForTest() {
        downloadRenderedFile();
      },
      _buildRenderedFilenameForTest(file, format) {
        return buildRenderedFilename(file, format);
      },
      _recordCompressedExportForTest(buffer, format, bitrate) {
        return recordCompressedExport(buffer, format, bitrate);
      },
      _renderMp3ExportForTest(buffer, bitrate) {
        return renderMp3Export(buffer, bitrate);
      },
      _refreshExportFormatsForTest() {
        syncExportFormatOptions();
      },
      _encodeWavForTest(buffer) {
        return core.encodeWav(buffer);
      },
      _coreForTest: core,
      _settingsForTest: readSettings,
      _enhanceStateForTest() {
        return enhanceState;
      },
      _undoAutoEnhanceForTest() {
        undoAutoEnhance();
      }
    };
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) {
      return '–';
    }
    const rounded = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return minutes + ':' + String(remainder).padStart(2, '0');
  }

  function formatTimer(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '–';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1) + ' ' + units[unitIndex];
  }

  function describeFormat(file) {
    const type = String(file.type || '').trim();
    if (type) {
      return type;
    }
    const parts = String(file.name || '').split('.');
    return parts.length > 1 ? parts.pop().toUpperCase() : 'Unbekannt';
  }

  function signedDb(value) {
    const number = Number(value);
    const text = number > 0 ? '+' + number.toFixed(1) : number.toFixed(1);
    return text.replace('.0', '') + ' dB';
  }

  function formatLoudness(value) {
    if (!Number.isFinite(value)) {
      return 'nicht bestimmbar';
    }
    return value.toFixed(1).replace('.0', '') + ' LUFS approx.';
  }

  function formatPeak(value) {
    if (!Number.isFinite(value)) {
      return '–';
    }
    return (20 * Math.log10(Math.max(value, 0.000001))).toFixed(1) + ' dBFS';
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '') || 'master';
  }

  function buildRenderedFilename(file, format) {
    return sanitizeFilename((file && file.name) || 'master') + '-master.' + ((format && format.extension) || 'wav');
  }

  function getDefaultBitrateForFormat(format) {
    return format && format.id === 'mp3' ? PREFERRED_MP3_BITRATE : DEFAULT_COMPRESSED_BITRATE;
  }

  function getFormatNoteText(format, mp3Support) {
    if (!format) {
      return '';
    }
    const supportSummary = [];
    if (format.id !== 'mp3') {
      supportSummary.push(buildMp3AvailabilityText(mp3Support));
    }
    BROWSER_DEPENDENT_EXPORT_FORMATS.forEach((candidate) => {
      if (candidate.id !== format.id) {
        supportSummary.push(buildBrowserDependentFormatAvailabilityText(candidate));
      }
    });
    return [format.description].concat(supportSummary.filter(Boolean)).join(' ');
  }

  function buildMp3AvailabilityText(mp3Support) {
    if (mp3Support && mp3Support.available) {
      return 'MP3 ist lokal verfügbar. Nutzbarer Pfad: ' + buildMp3RouteList(mp3Support) + '.';
    }
    return 'MP3 ist derzeit nicht verfügbar, weil weder ein nativer Browser-Encoder noch ein lokaler MP3-Encoder oder Same-Origin-Konverter erkannt wurde.';
  }

  function buildMp3RouteList(mp3Support) {
    const routes = [];
    if (mp3Support && mp3Support.nativeMimeType) {
      routes.push('nativer Browser-Encoder');
    }
    if (mp3Support && mp3Support.clientEncoder) {
      routes.push('lokaler MP3-Encoder im App-Bundle');
    }
    if (mp3Support && mp3Support.serverEndpoint) {
      routes.push('Same-Origin-Konverter');
    }
    return routes.length ? routes.join(', ') : 'keinen nutzbaren Pfad';
  }

  function buildBrowserDependentFormatAvailabilityText(format) {
    if (!format || !format.mimeType) {
      return '';
    }
    return format.label.replace(/\s*·.*$/, '') + ' ist browserabhängig und '
      + (isMimeTypeSupported(format.mimeType) ? 'in diesem Browser verfügbar.' : 'in diesem Browser derzeit nicht verfügbar.');
  }

  function createRealtimeAudioContext(sampleRate) {
    const StandardCtor = window.AudioContext || globalThis.AudioContext;
    if (typeof StandardCtor === 'function') {
      return new StandardCtor({ sampleRate });
    }

    const WebkitCtor = window.webkitAudioContext || globalThis.webkitAudioContext;
    if (typeof WebkitCtor === 'function') {
      return new WebkitCtor();
    }

    throw new Error('Web Audio API ist für komprimierte Browser-Exporte nicht verfügbar.');
  }

  function canRecordCompressedAudio() {
    return typeof MediaRecorder === 'function'
      && typeof (window.AudioContext || window.webkitAudioContext || globalThis.AudioContext || globalThis.webkitAudioContext) === 'function';
  }

  function resolveSupportedMimeType(mimeTypes) {
    if (!Array.isArray(mimeTypes)) {
      return '';
    }
    for (let index = 0; index < mimeTypes.length; index += 1) {
      const mimeType = mimeTypes[index];
      if (isMimeTypeSupported(mimeType)) {
        return mimeType;
      }
    }
    return '';
  }

  function resolveSupportedMp3MimeType() {
    return resolveSupportedMimeType(MP3_MIME_TYPES);
  }

  function isMimeTypeSupported(mimeType) {
    return Boolean(mimeType)
      && typeof MediaRecorder === 'function'
      && typeof MediaRecorder.isTypeSupported === 'function'
      && MediaRecorder.isTypeSupported(mimeType);
  }

  function getClientMp3Encoder() {
    const customEncoder = window.__JACKDARCKART_MP3_ENCODER__ || globalThis.__JACKDARCKART_MP3_ENCODER__;
    if (customEncoder && typeof customEncoder.encode === 'function') {
      return { id: 'adapter', encoder: customEncoder };
    }
    const lamejs = window.lamejs || globalThis.lamejs;
    if (lamejs && typeof lamejs.Mp3Encoder === 'function') {
      return { id: 'lamejs', library: lamejs };
    }
    return null;
  }

  function readConverterConfig() {
    return (window.__JACKDARCKART_CONFIG__ || globalThis.__JACKDARCKART_CONFIG__ || {}).converter;
  }

  function resolveSameOriginEndpoint(endpoint) {
    if (typeof endpoint !== 'string') {
      return '';
    }
    const trimmed = endpoint.trim();
    if (!trimmed || /^data:|^blob:|^javascript:/i.test(trimmed) || trimmed.startsWith('//')) {
      return '';
    }
    if (/^https?:\/\//i.test(trimmed)) {
      const resolvedUrl = tryCreateUrl(trimmed);
      return resolvedUrl && resolvedUrl.origin === getWindowOrigin() ? resolvedUrl.href : '';
    }
    return normalizeSameOriginPath(trimmed);
  }

  function resolveMp3ServerEndpoint() {
    const config = readConverterConfig();
    return resolveSameOriginEndpoint(config && config.mp3Export && config.mp3Export.serverEndpoint);
  }

  function getWindowOrigin() {
    const href = window && window.location && window.location.href;
    const match = typeof href === 'string' ? href.match(/^[a-z]+:\/\/[^/]+/i) : null;
    return match ? match[0] : '';
  }

  function tryCreateUrl(value) {
    const UrlCtor = (window && typeof window.URL === 'function')
      ? window.URL
      : (typeof globalThis.URL === 'function' ? globalThis.URL : null);
    if (typeof UrlCtor !== 'function') {
      return null;
    }
    try {
      return new UrlCtor(value, window.location && window.location.href ? window.location.href : undefined);
    } catch (error) {
      return null;
    }
  }

  function normalizeSameOriginPath(value) {
    if (typeof value !== 'string' || !value) {
      return '';
    }
    const parts = String(value).match(/^([^?#]*)([?#].*)?$/);
    const rawPath = parts && parts[1] ? parts[1] : value;
    const suffix = parts && parts[2] ? parts[2] : '';
    if (!rawPath) {
      return '';
    }
    if (rawPath.charAt(0) === '/') {
      return rawPath + suffix;
    }
    const locationPath = window && window.location && typeof window.location.pathname === 'string'
      ? window.location.pathname
      : '/';
    const baseDir = locationPath.replace(/[^/]*$/, '');
    const segments = (baseDir + rawPath).split('/');
    const normalized = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (normalized.length) {
          normalized.pop();
        }
        continue;
      }
      normalized.push(segment);
    }
    return '/' + normalized.join('/') + suffix;
  }

  async function encodeMp3Locally(masteredBuffer, bitrate, encoder) {
    if (!encoder || !encoder.id) {
      throw new Error('Lokaler MP3-Encoder ist nicht verfügbar.');
    }

    if (encoder.id === 'adapter') {
      const blob = await encoder.encoder.encode({
        audioBuffer: masteredBuffer,
        bitrate,
        mimeType: 'audio/mpeg'
      });
      return normalizeMp3Blob(blob);
    }

    if (encoder.id === 'lamejs') {
      return encodeMp3WithLameJs(masteredBuffer, bitrate, encoder.library);
    }

    throw new Error('Lokaler MP3-Encoder wird nicht unterstützt.');
  }

  async function requestServerMp3Conversion(masteredBuffer, bitrate, endpoint, wavBlob) {
    if (!endpoint) {
      throw new Error('Kein Same-Origin-Konverter für MP3 konfiguriert.');
    }
    const fetchImplementation = (window && typeof window.fetch === 'function')
      ? window.fetch.bind(window)
      : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (!fetchImplementation) {
      throw new Error('Serverseitiger MP3-Export erfordert fetch-Unterstützung im Browser.');
    }
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'audio/wav',
        'X-Converter-Target-Format': 'mp3',
        'X-Converter-Bitrate': String(bitrate),
        'X-Converter-Sample-Rate': String(masteredBuffer.sampleRate),
        'X-Converter-Channels': String(masteredBuffer.numberOfChannels)
      },
      body: wavBlob instanceof Blob ? wavBlob : new BrowserAudioMasteringCore().encodeWav(masteredBuffer)
    });
    if (!response || !response.ok || typeof response.blob !== 'function') {
      throw new Error('Same-Origin-Konverter konnte keine MP3-Datei erzeugen.');
    }
    return normalizeMp3Blob(await response.blob());
  }

  async function encodeMp3WithLameJs(buffer, bitrate, lamejs) {
    const sampleRate = Math.max(8000, Math.round(buffer.sampleRate) || 44100);
    const channelCount = Math.min(2, Math.max(1, buffer.numberOfChannels || 1));
    const bitrateKbps = normalizeMp3BitrateKbps(bitrate);
    const encoder = new lamejs.Mp3Encoder(channelCount, sampleRate, bitrateKbps);
    const frameSize = 1152;
    const chunks = [];
    for (let offset = 0; offset < buffer.length; offset += frameSize) {
      const frames = Math.min(frameSize, buffer.length - offset);
      const left = convertAudioBufferChannelToInt16(buffer, 0, offset, frames);
      const right = channelCount > 1
        ? convertAudioBufferChannelToInt16(buffer, 1, offset, frames)
        : null;
      const encoded = channelCount > 1
        ? encoder.encodeBuffer(left, right)
        : encoder.encodeBuffer(left);
      if (encoded && encoded.length) {
        chunks.push(new Uint8Array(encoded));
      }
    }
    const flushed = encoder.flush();
    if (flushed && flushed.length) {
      chunks.push(new Uint8Array(flushed));
    }
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  function convertAudioBufferChannelToInt16(buffer, channelIndex, offset, frameCount) {
    const source = buffer.getChannelData(Math.min(channelIndex, buffer.numberOfChannels - 1));
    const pcm = new Int16Array(frameCount);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      pcm[frameIndex] = floatToInt16Sample(source ? source[offset + frameIndex] || 0 : 0);
    }
    return pcm;
  }

  function floatToInt16Sample(sample) {
    const clamped = Math.max(-1, Math.min(1, Number(sample) || 0));
    return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7FFF);
  }

  function normalizeMp3BitrateKbps(bitrate) {
    const value = Math.round((Number(bitrate) || Number(PREFERRED_MP3_BITRATE)) / 1000);
    const supported = [96, 112, 128, 160, 192, 224, 256, 320];
    return supported.reduce((closest, candidate) => (
      Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
    ), supported[0]);
  }

  async function normalizeMp3Blob(blob) {
    if (blob instanceof Blob && blob.type === 'audio/mpeg') {
      return blob;
    }
    if (!(blob instanceof Blob)) {
      throw new Error('MP3-Encoder lieferte keine Blob-Antwort zurück.');
    }
    const arrayBuffer = typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : blob;
    return new Blob([arrayBuffer], { type: 'audio/mpeg' });
  }

  async function closeAudioContextQuietly(context) {
    if (!context || typeof context.close !== 'function') {
      return;
    }

    try {
      await context.close();
    } catch (error) {
      return;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window[MODULE_KEY] = {
    bootstrap,
    destroy,
    _createStudioForTest: createStudio
  };
}());
 
