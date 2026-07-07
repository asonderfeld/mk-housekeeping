// MK Housekeeping — Zimmer-Zuweisungen (Vercel Serverless Function)
// Speichert pro Zimmer-Key die zugewiesene Housekeeper-ID als Redis-Hash (hk:assignments).
// HSET/HDEL sind atomar — kein Read-Modify-Write-Konflikt. Vorher lagen
// Zuweisungen nur im Browser-Speicher (S.assignments) und gingen bei Logout/
// Reload verloren — dieser Endpunkt macht sie geräteübergreifend persistent,
// genau wie schon bei Aufdoppeln/Pausen/Reinigungszeiten.
const { redis, parseVal } = require('./_redis');

const KEY = 'hk:assignments';

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
      const assignments = await getAll(r);
      res.status(200).json({ ok: true, assignments });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, key, uid } = req.body || {};
    if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }

    if (action === 'set') {
      if (!uid) { res.status(400).json({ error: '"uid" fehlt' }); return; }
      await r.hset(KEY, { [key]: JSON.stringify(uid) });
      const assignments = await getAll(r);
      res.status(200).json({ ok: true, assignments });
      return;
    }

    if (action === 'clear') {
      await r.hdel(KEY, key);
      const assignments = await getAll(r);
      res.status(200).json({ ok: true, assignments });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[assignments]', e.message);
    res.status(500).json({ error: e.message });
  }
};
