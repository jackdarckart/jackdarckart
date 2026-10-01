'use strict';

// Vertrauenswürdiger Same-Origin-Resolver für Remote-Audio-Importe (z. B. Suno-CDN-MP4).
// Der Proxy ist bewusst kein offener Proxy: nur freigegebene HTTPS-Audioziele,
// keine internen Netzwerkziele, harte Größen-, Timeout- und Redirect-Grenzen.

const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_REDIRECTS = 2;
const SUNO_CDN_HOST_PATTERN = /^cdn\d*\.suno\.ai$/;
const SUNO_CDN_MEDIA_PATTERN = /\.(mp3|mp4|m4a)$/i;
const AUDIO_MIME_TYPES = Object.assign(Object.create(null), {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'application/ogg': 'ogg',
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/mp4': 'mp4', 'audio/x-m4a': 'mp4', 'audio/m4a': 'mp4',
  'video/mp4': 'mp4', 'application/mp4': 'mp4',
  'audio/webm': 'webm',
  'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff'
});

class ProxyError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProxyError';
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
  // 192.168.0.0/16 (privat) und 192.0.0.0/16 (deckt 192.0.0.0/24 sowie TEST-NET-1 192.0.2.0/24 ab) werden blockiert.
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

function defaultAllowTarget(url) {
  return SUNO_CDN_HOST_PATTERN.test(url.hostname) && SUNO_CDN_MEDIA_PATTERN.test(url.pathname);
}

function validateTargetUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch (error) {
    throw new ProxyError('Ungültige Ziel-URL.', 400);
  }
  if (url.protocol !== 'https:') {
    throw new ProxyError('Nur HTTPS-Ziele sind erlaubt.', 400);
  }
  if (url.username || url.password) {
    throw new ProxyError('URLs mit Zugangsdaten sind nicht erlaubt.', 400);
  }
  if (url.port && url.port !== '443') {
    throw new ProxyError('Nur der Standard-HTTPS-Port ist erlaubt.', 400);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') || net.isIP(host) || host.startsWith('[')
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    throw new ProxyError('Lokale oder interne Ziele und IP-Adressen sind nicht erlaubt.', 403);
  }
  url.hash = '';
  if (!defaultAllowTarget(url)) {
    throw new ProxyError('Dieses Ziel ist für den Proxy nicht freigegeben.', 403);
  }
  return url;
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
      done(new ProxyError('Interne Netzwerkziele sind nicht erlaubt.', 403));
      return;
    }
    if (options.all) {
      done(null, entries);
      return;
    }
    done(null, entries[0].address, entries[0].family);
  });
}

function sniffAudioContainer(bytes) {
  const ascii = (start, length) => bytes.slice(start, start + length).toString('latin1');
  if (bytes.length < 12) return '';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2)) return 'mp3';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(4, 4) === 'ftyp' && /^[\x20-\x7e]{4}$/.test(ascii(8, 4))) return 'mp4';
  if (ascii(0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(8, 4))) return 'aiff';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return '';
}

function normalizeMimeType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function assertAudioResponse(contentType, bytes) {
  const mime = normalizeMimeType(contentType);
  const container = AUDIO_MIME_TYPES[mime];
  if (!container || (bytes && sniffAudioContainer(bytes) !== container)) {
    throw new ProxyError('Die Antwort ist kein unterstütztes Audioformat (MIME/Dateisignatur).', 502);
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
      // Es werden bewusst keine Client-Header, Cookies oder Credentials weitergereicht.
      headers: { accept: 'audio/*,video/mp4;q=0.9', 'user-agent': 'jackdarckart-remote-audio-proxy' }
    }, resolve);
    request.on('error', reject);
    if (typeof options.register === 'function') options.register(request);
    request.end();
  });
}

async function fetchRemoteAudio(target, options) {
  const settings = options || {};
  const maxBytes = settings.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = settings.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRedirects = Number.isInteger(settings.maxRedirects) ? settings.maxRedirects : DEFAULT_MAX_REDIRECTS;
  const pending = new Set();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    pending.forEach((request) => request.destroy(new ProxyError('Zeitlimit überschritten.', 504)));
  }, timeoutMs);
  const register = (request) => {
    pending.add(request);
    request.on('close', () => pending.delete(request));
  };

  try {
    let url = target;
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const response = await requestOnce(url, Object.assign({}, settings, { register }));
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        if (redirect === maxRedirects || !response.headers.location) {
          throw new ProxyError('Weiterleitung nicht erlaubt oder Limit erreicht.', 502);
        }
        url = validateTargetUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (status !== 200) {
        response.resume();
        throw new ProxyError('Audioquelle nicht erreichbar.', 502);
      }
      const contentType = response.headers['content-type'];
      assertAudioResponse(contentType);
      const length = response.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > maxBytes)) {
        response.destroy();
        throw new ProxyError('Die Datei ist zu groß für den sicheren Import.', 413);
      }
      const body = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new ProxyError('Die Datei ist zu groß für den sicheren Import.', 413));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
      assertAudioResponse(contentType, body);
      return { body, contentType: normalizeMimeType(contentType), url: url.href };
    }
    throw new ProxyError('Weiterleitung nicht erlaubt oder Limit erreicht.', 502);
  } catch (error) {
    if (timedOut) throw new ProxyError('Zeitlimit überschritten.', 504);
    throw error;
  } finally {
    clearTimeout(timer);
    pending.forEach((request) => request.destroy());
  }
}

function createRemoteAudioProxyHandler(options) {
  const settings = options || {};
  return async function handleRemoteAudioProxyRequest(request, response) {
    const send = (status, payload, headers) => {
      response.writeHead(status, Object.assign({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      }, headers));
      response.end(payload);
    };
    try {
      if (request.method !== 'GET') {
        throw new ProxyError('Nur GET wird unterstützt.', 405);
      }
      const requestUrl = new URL(request.url, 'https://proxy.invalid');
      const target = validateTargetUrl(requestUrl.searchParams.get('url'), settings);
      const audio = await fetchRemoteAudio(target, settings);
      send(200, audio.body, {
        'Content-Type': audio.contentType,
        'Content-Length': String(audio.body.length)
      });
    } catch (error) {
      const status = error instanceof ProxyError ? error.status : 502;
      const message = error instanceof ProxyError ? error.message : 'Remote-Import über den Proxy fehlgeschlagen.';
      send(status, JSON.stringify({ error: message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  };
}

module.exports = {
  ProxyError,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_REDIRECTS,
  createRemoteAudioProxyHandler,
  fetchRemoteAudio,
  validateTargetUrl,
  isBlockedAddress,
  sniffAudioContainer,
  safeLookup
};
