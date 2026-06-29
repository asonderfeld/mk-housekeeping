// MK Housekeeping — gemeinsamer Redis-Client (Redis Cloud, über Vercel Storage Integration)
// Vercel setzt bei der "Redis"-Marketplace-Integration (Redis Cloud) die
// Variable REDIS_URL mit einer klassischen redis://-Verbindungs-URL — das ist
// KEINE REST-API wie bei Upstash, sondern eine normale TCP-Verbindung. Dafür
// brauchen wir einen echten Redis-Client (ioredis) statt eines REST-Clients.
// Dateien mit führendem "_" werden von Vercel NICHT als eigene API-Route behandelt.
const Redis = require('ioredis');

let _client = null;

function redis() {
  if (_client) return _client;
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.REDIS_CONNECTION_STRING;
  if (!url) {
    throw new Error('Redis ist nicht konfiguriert. In Vercel unter Storage eine Redis-Datenbank anlegen/verbinden, dann ist REDIS_URL automatisch gesetzt.');
  }
  _client = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 8000,
  });
  _client.on('error', (e) => console.error('[redis] Verbindungsfehler:', e.message));
  return _client;
}

// Wert robust parsen — kommt als String aus Redis, wir speichern überall JSON.
function parseVal(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

module.exports = { redis, parseVal };
