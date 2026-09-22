'use strict';

(function () {
  const MODULE_KEY = '__JACKDARCKART_CONVERTER__';
  const CLEANUP_WINDOW_MS = 2 * 60 * 1000;
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

  class VaultSyncAdapterStub {
    isAvailable() {
      return false;
    }

    async save() {
      throw new Error('Kein verschlüsselter Vault verfügbar. Die Phase-27.3-Implementierung muss separat ergänzt werden.');
    }
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

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = settings.compThreshold;
      compressor.knee.value = 18;
      compressor.ratio.value = settings.compRatio;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.16;

      const makeup = context.createGain();
      makeup.gain.value = this.getMakeupGain(settings);

      const widthStage = this.createStereoWidthStage(context, settings.stereoWidth, sourceChannelCount);
      const limiter = context.createWaveShaper();
      limiter.curve = this.createLimiterCurve(this.dbToLinear(settings.limiterCeiling));
      limiter.oversample = '4x';

      input.connect(lowEq);
      lowEq.connect(midEq);
      midEq.connect(highEq);
      highEq.connect(compressor);
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

    createStereoWidthStage(context, stereoWidthPercent, sourceChannelCount) {
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

      leftDirect.gain.value = (1 + width) * 0.5;
      rightDirect.gain.value = (1 + width) * 0.5;
      leftCross.gain.value = (1 - width) * 0.5;
      rightCross.gain.value = (1 - width) * 0.5;

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
    const vaultAdapter = new VaultSyncAdapterStub();
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
      vaultButton: document.getElementById('converter-vault-button'),
      vaultStatus: document.getElementById('converter-vault-status')
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

    const controls = Object.fromEntries(controlKeys.map((id) => [id, document.getElementById(id)]));
    const outputs = Object.fromEntries(controlKeys.map((id) => [id + '-value', document.getElementById(id + '-value')]));
    const listeners = [];
    let audioContext = null;
    let loadedFile = null;
    let loadedBuffer = null;
    let previewSource = null;
    let previewAnalyser = null;
    let previewStartAt = 0;
    let previewOffset = 0;
    let previewAnimationFrame = 0;
    let cleanupTimeout = 0;
    let cleanupInterval = 0;
    let renderedAsset = null;
    let isPreviewStopping = false;

    function bind(target, type, listener, options) {
      if (!target || typeof target.addEventListener !== 'function') {
        return;
      }
      target.addEventListener(type, listener, options);
      listeners.push(() => target.removeEventListener(type, listener, options));
    }

    function init() {
      syncExportFormatOptions();
      updateControlOutputs();
      drawWaveformIdle();
      drawSpectrumIdle();
      updateButtons();

      bind(elements.browseButton, 'click', () => {
        if (elements.fileInput) {
          elements.fileInput.click();
        }
      });
      bind(elements.fileInput, 'change', () => handleSelectedFiles(elements.fileInput.files));
      bind(elements.resetButton, 'click', resetStudio);
      bind(elements.autoEnhance, 'click', applyAutoEnhance);
      bind(elements.previewToggle, 'click', togglePreview);
      bind(elements.previewStop, 'click', () => stopPreview(true));
      bind(elements.renderButton, 'click', renderMaster);
      bind(elements.downloadButton, 'click', downloadRenderedFile);
      bind(elements.clearRender, 'click', () => clearRenderedAsset('Temporäre Master-Datei manuell aus dem Speicher gelöscht.'));
      bind(elements.vaultButton, 'click', handleVaultAction);
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

      await resetPlaybackOnly();
      clearRenderedAsset('Vorherige temporäre Master-Datei entfernt, weil eine neue Quelldatei geladen wurde.');
      loadedFile = file;
      setRenderState('loading', 'Datei wird lokal dekodiert …');
      elements.importStatus.textContent = 'Datei wird lokal verarbeitet. Es findet kein Upload statt.';
      try {
        const context = await ensureAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        loadedBuffer = await decodeAudioBuffer(context, arrayBuffer);
        previewOffset = 0;
        updateMetadata(file, loadedBuffer);
        updateButtons();
        drawWaveform(loadedBuffer);
        updateAnalysisSummary();
        setRenderState('ready', 'Datei bereit – Preview und Render sind lokal verfügbar.');
        elements.importStatus.textContent = 'Datei erfolgreich lokal geladen. Alle Mastering-Schritte bleiben im Browser.';
      } catch (error) {
        loadedBuffer = null;
        updateButtons();
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
        targetLufs: Number(controls['converter-target-lufs'].value)
      };
    }

    function applyAutoEnhance() {
      if (!loadedBuffer) {
        return;
      }
      controls['converter-eq-low'].value = '1.5';
      controls['converter-eq-mid'].value = '2.5';
      controls['converter-eq-high'].value = '2';
      controls['converter-comp-threshold'].value = '-20';
      controls['converter-comp-ratio'].value = '3.2';
      controls['converter-limiter-ceiling'].value = '-1';
      controls['converter-stereo-width'].value = '118';
      controls['converter-target-lufs'].value = '-12';
      updateControlOutputs();
      elements.renderStatus.textContent = 'Auto-Enhance gesetzt: leichte Präsenzanhebung, moderater Glue-Kompressor und konservatives Ceiling.';
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

    function updateAnalysisSummary(renderReport, asset) {
      const sourceAnalysis = loadedBuffer ? core.analyzeBuffer(loadedBuffer) : null;
      const output = [];
      if (!loadedBuffer) {
        elements.analysisSummary.innerHTML = '<p><strong>Analyse:</strong> Noch keine Datei geladen.</p>';
        return;
      }
      output.push('<p><strong>Quelle:</strong> approx. ' + formatLoudness(sourceAnalysis && sourceAnalysis.loudnessDb) + ' · Peak ' + formatPeak(sourceAnalysis && sourceAnalysis.peak) + '</p>');
      if (renderReport && asset) {
        output.push('<p><strong>Master:</strong> approx. ' + formatLoudness(renderReport.outputApproxLufs) + ' · Peak ' + formatPeak(renderReport.peakAfter) + ' · ' + escapeHtml(asset.filename) + ' · ' + (asset.sampleRate / 1000).toFixed(1) + ' kHz</p>');
      } else {
        output.push('<p><strong>Master:</strong> Noch kein Render vorhanden. Preview und Regler arbeiten weiterhin lokal auf derselben Quelle.</p>');
      }
      elements.analysisSummary.innerHTML = output.join('');
    }

    async function handleVaultAction() {
      try {
        await vaultAdapter.save();
      } catch (error) {
        elements.vaultStatus.textContent = error.message;
      }
    }

    function resetStudio() {
      stopPreview(true);
      clearRenderedAsset('Temporäre Master-Datei entfernt, weil das Studio zurückgesetzt wurde.');
      loadedFile = null;
      loadedBuffer = null;
      previewOffset = 0;
      if (elements.fileInput) {
        elements.fileInput.value = '';
      }
      ['fileName', 'fileDuration', 'fileRate', 'fileSize', 'fileFormat', 'fileChannels'].forEach((key) => {
        elements[key].textContent = '–';
      });
      updateButtons();
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
      stopPreview(true);
      clearRenderedAsset('Temporäre Master-Datei bei Seitenwechsel bereinigt.');
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

  function resolveMp3ServerEndpoint() {
    const config = (window.__JACKDARCKART_CONFIG__ || globalThis.__JACKDARCKART_CONFIG__ || {}).converter;
    const endpoint = config && config.mp3Export && config.mp3Export.serverEndpoint;
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
 
