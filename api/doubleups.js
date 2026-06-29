// MK Housekeeping — Aufdoppeln-Status (Vercel Serverless Function)
// Speichert pro Zimmer-Key ein Aufdoppeln-Objekt als Redis-Hash (hk:doubleups).
// HSET/HDEL sind atomar — kein Read-Modify-Write-Konflikt mehr wie bei der
// vorherigen Git-Lösung. Reset erst bei der nächsten Zimmerreinigung nach
// Abschluss der Runde, für die markiert wurde (Logik unverändert im Frontend).
const { redis, parseVal } = require('./_redis');

const KEY = 'hk:doubleups';

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
      const doubleUps = await getAll(r);
      res.status(200).json({ ok: true, doubleUps });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, key, types, locked, need } = req.body || {};
    if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }

    if (action === 'set') {
      const val = { types: Array.isArray(types) ? types : [], locked: !!locked, need: !!need };
      await r.hset(KEY, { [key]: JSON.stringify(val) });
      const doubleUps = await getAll(r);
      res.status(200).json({ ok: true, doubleUps });
      return;
    }

    if (action === 'clear') {
      await r.hdel(KEY, key);
      const doubleUps = await getAll(r);
      res.status(200).json({ ok: true, doubleUps });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[doubleups]', e.message);
    res.status(500).json({ error: e.message });
  }
};
