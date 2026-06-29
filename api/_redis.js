// MK Housekeeping — gemeinsamer Redis-Client (Upstash, über Vercel Storage Integration)
// Wird von users.js / completions.js / doubleups.js / breaks.js genutzt.
// Dateien mit führendem "_" werden von Vercel NICHT als eigene API-Route behandelt.
const { Redis } = require('@upstash/redis');

let _client = null;

function redis() {
  if (_client) return _client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Redis ist nicht konfiguriert. In Vercel unter Storage eine Upstash-Redis-Datenbank anlegen/verbinden, dann sind KV_REST_API_URL und KV_REST_API_TOKEN automatisch gesetzt.');
  }
  _client = new Redis({ url, token });
  return _client;
}

// Wert robust parsen — je nach SDK-Version kommt entweder ein String oder
// bereits ein parsiertes Objekt zurück.
function parseVal(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

module.exports = { redis, parseVal };
