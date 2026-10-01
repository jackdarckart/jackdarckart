'use strict';

// Sichere Server-Komponente für den kontrollierten Suno-Audio-Download.
// Der Downloader ist strikt auf verifizierte Suno-Quellen beschränkt (kein offener Proxy),
// erzwingt HTTPS, blockiert interne/private Netzwerke (SSRF-Schutz) und prüft
// Timeouts, Payloads, Redirects sowie MIME- und Container-Signaturen (MP4/M4A/MP3).

const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_REDIRECTS = 2;

const SUNO_PAGE_HOSTS = ['suno.com', 'www.suno.com'];
const SUNO_CDN_HOST_PATTERN = /^cdn\d*\.suno\.ai$/i;
const SUNO_CDN_MEDIA_PATTERN = /\.(mp3|mp4|m4a)$/i;
const SUNO_SONG_ID_PATTERN = /^\/song\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const AUDIO_MIME_TYPES = Object.assign(Object.create(null), {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/mp4': 'mp4', 'audio/x-m4a': 'mp4', 'audio/m4a': 'mp4',
  'video/mp4': 'mp4', 'application/mp4': 'mp4'
});

class SunoDownloaderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SunoDownloaderError';
    this.status = status || 400;
  }
}

function isBlockedIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family !== 6) return true;
  const normalized = String(address).toLowerCase().split('%')[0];
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (normalized === '::' || normalized === '::1') return true;
  if (/^f[cd]/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (/^ff/.test(normalized)) return true;
  return false;
}

function safeLookup(hostname, lookupOptions, callback) {
  const options = typeof lookupOptions === 'function' ? {} : (lookupOptions || {});
  const done = typeof lookupOptions === 'function' ? lookupOptions : callback;
  dns.lookup(hostname, Object.assign({ verbatim: true }, options, { all: true }), (error, addresses) => {
    if (error) {
      done(error);
      return;
    }
    const entries = (Array.isArray(addresses) ? addresses : [addresses])
      .filter((entry) => entry && !isBlockedAddress(entry.address));
    if (!entries.length) {
      done(new SunoDownloaderError('Interne Netzwerkziele sind nicht erlaubt.', 403));
      return;
    }
    if (options.all) {
      done(null, entries);
      return;
    }
    done(null, entries[0].address, entries[0].family);
  });
}

function validateSunoUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch (error) {
    throw new SunoDownloaderError('Ungültige Ziel-URL.', 400);
  }
  if (url.protocol !== 'https:') {
    throw new SunoDownloaderError('Nur HTTPS-Ziele sind erlaubt.', 400);
  }
  if (url.username || url.password) {
    throw new SunoDownloaderError('URLs mit Zugangsdaten sind nicht erlaubt.', 400);
  }
  if (url.port && url.port !== '443') {
    throw new SunoDownloaderError('Nur der Standard-HTTPS-Port ist erlaubt.', 400);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') || net.isIP(host) || host.startsWith('[')
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    throw new SunoDownloaderError('Lokale oder interne Ziele und IP-Adressen sind nicht erlaubt.', 403);
  }
  url.hash = '';

  const isCdn = SUNO_CDN_HOST_PATTERN.test(host);
  const isPage = SUNO_PAGE_HOSTS.includes(host);

  if (!isCdn && !isPage) {
    throw new SunoDownloaderError('Dieses Ziel ist für den Suno-Downloader nicht freigegeben.', 403);
  }

  if (isCdn) {
    if (!SUNO_CDN_MEDIA_PATTERN.test(url.pathname)) {
      throw new SunoDownloaderError('Suno-CDN-Links müssen direkt auf eine .mp4-, .m4a- oder .mp3-Datei zeigen.', 403);
    }
  } else if (isPage) {
    if (!SUNO_SONG_ID_PATTERN.test(url.pathname)) {
      throw new SunoDownloaderError('Suno-Song-Links müssen eine gültige Song-UUID enthalten (/song/<uuid>).', 403);
    }
  }

  return url;
}

function resolveSunoMediaCandidates(input) {
  const url = validateSunoUrl(input);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (SUNO_PAGE_HOSTS.includes(host)) {
    const match = url.pathname.match(SUNO_SONG_ID_PATTERN);
    if (!match) {
      throw new SunoDownloaderError('Suno-Song-Links müssen eine gültige Song-UUID enthalten (/song/<uuid>).', 403);
    }
    const songId = match[1];
    return ['mp3', 'mp4'].map((extension) => validateSunoUrl(`https://cdn1.suno.ai/${songId}.${extension}`));
  }
  return [url];
}

function sniffAudioContainer(bytes) {
  const ascii = (start, length) => bytes.slice(start, start + length).toString('latin1');
  if (bytes.length < 12) return '';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2)) return 'mp3';
  if (ascii(4, 4) === 'ftyp' && /^[\x20-\x7e]{4}$/.test(ascii(8, 4))) return 'mp4';
  return '';
}

function normalizeMimeType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function assertAudioResponse(contentType, bytes) {
  const mime = normalizeMimeType(contentType);
  const container = AUDIO_MIME_TYPES[mime];
  if (!container || (bytes && sniffAudioContainer(bytes) !== container)) {
    throw new SunoDownloaderError('Die Antwort ist kein unterstütztes Audioformat (MIME/Dateisignatur).', 502);
  }
  return mime;
}

function requestOnce(url, options) {
  return new Promise((resolve, reject) => {
    const request = (options.httpsModule || https).request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      lookup: options.lookup || safeLookup,
      headers: {
        accept: 'audio/*,video/mp4;q=0.9',
        'user-agent': 'jackdarckart-suno-downloader'
      }
    }, resolve);
    request.on('error', reject);
    if (typeof options.register === 'function') options.register(request);
    request.end();
  });
}

async function fetchSingleSunoMedia(targetUrl, settings, register) {
  const maxBytes = settings.maxBytes || DEFAULT_MAX_BYTES;
  const maxRedirects = Number.isInteger(settings.maxRedirects) ? settings.maxRedirects : DEFAULT_MAX_REDIRECTS;

  let url = targetUrl;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await requestOnce(url, Object.assign({}, settings, { register }));
    const status = response.statusCode || 0;
    if (status >= 300 && status < 400) {
      response.resume();
      if (redirect === maxRedirects || !response.headers.location) {
        throw new SunoDownloaderError('Weiterleitung nicht erlaubt oder Limit erreicht.', 502);
      }
      url = validateSunoUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new SunoDownloaderError('Audioquelle nicht erreichbar.', 502);
    }
    const contentType = response.headers['content-type'];
    assertAudioResponse(contentType);
    const length = response.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > maxBytes)) {
      response.destroy();
      throw new SunoDownloaderError('Die Datei ist zu groß für den sicheren Download.', 413);
    }
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new SunoDownloaderError('Die Datei ist zu groß für den sicheren Download.', 413));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    assertAudioResponse(contentType, body);
    return {
      body,
      contentType: normalizeMimeType(contentType),
      url: url.href
    };
  }
  throw new SunoDownloaderError('Weiterleitung nicht erlaubt oder Limit erreicht.', 502);
}

async function downloadSunoAudio(input, options) {
  const settings = options || {};
  const timeoutMs = settings.timeoutMs || DEFAULT_TIMEOUT_MS;
  const candidates = resolveSunoMediaCandidates(input);
  const pending = new Set();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    pending.forEach((request) => request.destroy(new SunoDownloaderError('Zeitlimit überschritten.', 504)));
  }, timeoutMs);

  const register = (request) => {
    pending.add(request);
    request.on('close', () => pending.delete(request));
  };

  try {
    let lastError = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      try {
        const result = await fetchSingleSunoMedia(candidate, settings, register);
        return result;
      } catch (error) {
        if (timedOut) throw new SunoDownloaderError('Zeitlimit überschritten.', 504);
        // Bei 502 (Quelle nicht erreichbar z. B. 404) und weiteren Kandidaten: nächsten Kandidaten probieren
        const isRetryable = error instanceof SunoDownloaderError && error.status === 502 && candidates.length > 1;
        if (!isRetryable || i === candidates.length - 1) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError || new SunoDownloaderError('Audioquelle nicht erreichbar.', 502);
  } catch (error) {
    if (timedOut) throw new SunoDownloaderError('Zeitlimit überschritten.', 504);
    throw error;
  } finally {
    clearTimeout(timer);
    pending.forEach((request) => request.destroy());
  }
}

function createSunoDownloaderHandler(options) {
  const settings = options || {};
  return async function handleSunoDownloaderRequest(request, response) {
    const send = (status, payload, headers) => {
      response.writeHead(status, Object.assign({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      }, headers));
      response.end(payload);
    };

    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new SunoDownloaderError('Nur GET und HEAD werden unterstützt.', 405);
      }
      const requestUrl = new URL(request.url, 'https://downloader.invalid');
      if (requestUrl.searchParams.has('check') || requestUrl.searchParams.has('probe')) {
        send(200, request.method === 'HEAD' ? '' : JSON.stringify({ status: 'ok', service: 'suno-downloader' }), {
          'Content-Type': 'application/json; charset=utf-8'
        });
        return;
      }
      if (request.method === 'HEAD' && !requestUrl.searchParams.has('url')) {
        send(200, '', {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Downloader-Service': 'suno'
        });
        return;
      }
      const targetParam = requestUrl.searchParams.get('url');
      if (!targetParam) {
        throw new SunoDownloaderError('Ungültige Ziel-URL.', 400);
      }
      const audio = await downloadSunoAudio(targetParam, settings);
      send(200, request.method === 'HEAD' ? '' : audio.body, {
        'Content-Type': audio.contentType,
        'Content-Length': String(audio.body.length)
      });
    } catch (error) {
      const status = error instanceof SunoDownloaderError ? error.status : 502;
      const message = error instanceof SunoDownloaderError ? error.message : 'Suno-Download fehlgeschlagen.';
      send(status, request.method === 'HEAD' ? '' : JSON.stringify({ error: message }), {
        'Content-Type': 'application/json; charset=utf-8'
      });
    }
  };
}

module.exports = {
  SunoDownloaderError,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_REDIRECTS,
  validateSunoUrl,
  resolveSunoMediaCandidates,
  downloadSunoAudio,
  createSunoDownloaderHandler,
  isBlockedAddress,
  sniffAudioContainer,
  safeLookup
};
