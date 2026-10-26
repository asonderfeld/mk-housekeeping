// MK Housekeeping — Zimmer-Zuweisungen (Vercel Serverless Function)
// Speichert pro Zimmer-Key die zugewiesene Housekeeper-ID als Redis-Hash (hk:assignments).
// HSET/HDEL sind atomar — kein Read-Modify-Write-Konflikt. Vorher lagen
// Zuweisungen nur im Browser-Speicher (S.assignments) und gingen bei Logout/
// Reload verloren — dieser Endpunkt macht sie geräteübergreifend persistent,
// genau wie schon bei Aufdoppeln/Pausen/Reinigungszeiten.
//
// Sicherheits-Update: set/clear verlangen jetzt eine gültige Session (jeder
// angemeldete Nutzer, z.B. Housekeeper beim Abschluss der eigenen Reinigung).
// Das komplette Leeren eines Hauses lief bisher als N einzelne "clear"-Calls
// vom Client und war serverseitig nicht von einem normalen Einzel-Clear zu
// unterscheiden — dafür jetzt eine eigene, atomare Aktion "clearProperty",
// die zusätzlich die Rolle "admin" verlangt.
const { redis, parseVal } = require('./_redis');
const { getSession, tokenFromReq } = require('./_auth');

const KEY = 'hk:assignments';
// Rush-Markierungen (v6.9.0): pro Zimmer-Key {ts, by}. Der Client wertet nur
// Markierungen von heute aus (ts >= lokale Mitternacht) — alte verfallen also
// automatisch, auch wenn sie nie aktiv aufgehoben wurden.
const RUSH_KEY = 'hk:rush';

async function getRush(r) {
  const map = await r.hgetall(RUSH_KEY);
  if (!map) return {};
  const out = {};
  Object.entries(map).forEach(([k, v]) => { out[k] = parseVal(v); });
  return out;
}

async function getAll(r) {
  const map = await r.hgetall(KEY);
  if (!map) return {};
  const out = {};
  Object.entries(map).forEach(([k, v]) => { out[k] = parseVal(v); });
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const r = redis();

    if (req.method === 'GET') {
      const [assignments, rush] = await Promise.all([getAll(r), getRush(r)]);
      res.status(200).json({ ok: true, assignments, rush });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, key, keys, uid, prop } = req.body || {};
    const session = await getSession(r, tokenFromReq(req));
    if (!session) { res.status(401).json({ error: 'Bitte erneut anmelden.' }); return; }

    if (action === 'set') {
      if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }
      if (!uid) { res.status(400).json({ error: '"uid" fehlt' }); return; }
      await r.hset(KEY, { [key]: JSON.stringify(uid) });
      const assignments = await getAll(r);
      res.status(200).json({ ok: true, assignments });
      return;
    }

    if (action === 'clear') {
      if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }
      await r.hdel(KEY, key);
      const assignments = await getAll(r);
      res.status(200).json({ ok: true, assignments });
      return;
    }

    if (action === 'clearProperty') {
      if (session.role !== 'admin') { res.status(403).json({ error: 'Nur Admins dürfen alle Zuweisungen eines Hauses aufheben.' }); return; }
      if (!prop) { res.status(400).json({ error: '"prop" fehlt' }); return; }
      const all = await getAll(r);
      const keys = Object.keys(all).filter(k => k.startsWith(prop + '_'));
      if (keys.length) await r.hdel(KEY, ...keys);
      const assignments = await getAll(r);
      res.status(200).json({ ok: true, assignments });
      return;
    }

    // Rush setzen: nur Admins (Hausdamen). Mehrere Zimmer auf einmal möglich.
    if (action === 'rushSet') {
      if (session.role !== 'admin') { res.status(403).json({ error: 'Nur Admins/Hausdamen dürfen Rush setzen.' }); return; }
      const list = Array.isArray(keys) ? keys.filter(Boolean) : (key ? [key] : []);
      if (!list.length) { res.status(400).json({ error: '"key" fehlt' }); return; }
      const val = JSON.stringify({ ts: Date.now(), by: session.userId || session.id || '' });
      const obj = {}; list.forEach(k => { obj[k] = val; });
      await r.hset(RUSH_KEY, obj);
      res.status(200).json({ ok: true, rush: await getRush(r) });
      return;
    }

    // Rush aufheben: Admins jederzeit; Housekeeper beim Abschluss der Reinigung.
    if (action === 'rushClear') {
      if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }
      await r.hdel(RUSH_KEY, key);
      res.status(200).json({ ok: true, rush: await getRush(r) });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[assignments]', e.message);
    res.status(500).json({ error: e.message });
  }
};
