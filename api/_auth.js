// MK Housekeeping — leichte Server-Session (Redis-gestützt)
// Vorher war die "Anmeldung" rein clientseitig: das Frontend hat die volle
// Nutzerliste (inkl. Klartext-Passwort) geladen und lokal verglichen, und
// jede API-Route hat der vom Browser mitgeschickten User-Id/Rolle blind
// vertraut. Jetzt bekommt der Client nach erfolgreichem Login (siehe
// users.js, Aktion "login") ein zufälliges Token, das serverseitig in Redis
// auf User-Id + Rolle zeigt. Schreibende/sensible Routen prüfen dieses
// Token, bevor sie etwas tun.
const crypto = require('crypto');
const { redis, parseVal } = require('./_redis');

const SESSIONS_KEY = 'hk:sessions';

async function createSession(r, user) {
  const token = crypto.randomBytes(24).toString('hex');
  await r.hset(SESSIONS_KEY, { [token]: JSON.stringify({ id: user.id, role: user.role, ts: Date.now() }) });
  return token;
}

// Liefert {id, role, ts} oder null, wenn das Token fehlt/unbekannt ist.
async function getSession(r, token) {
  if (!token) return null;
  const raw = await r.hget(SESSIONS_KEY, token);
  return raw ? parseVal(raw) : null;
}

async function destroySession(r, token) {
  if (token) await r.hdel(SESSIONS_KEY, token);
}

// Token kommt vom Frontend entweder als Header oder im JSON-Body mit ("token").
function tokenFromReq(req) {
  return (req.headers && req.headers['x-session-token']) || (req.body && req.body.token) || null;
}

module.exports = { createSession, getSession, destroySession, tokenFromReq };
