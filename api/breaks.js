// MK Housekeeping — Pausen-Log (Vercel Serverless Function)
// Speichert Pausen als Redis-Liste (hk:breaks). RPUSH ist atomar — kein
// Read-Modify-Write-Konflikt mehr wie bei der vorherigen Git-Lösung.
const { redis, parseVal } = require('./_redis');

const KEY = 'hk:breaks';

async function getAll(r) {
  const raw = await r.lrange(KEY, 0, -1);
  return raw.map(parseVal);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const r = redis();

    if (req.method === 'GET') {
      const breaks = await getAll(r);
      res.status(200).json({ ok: true, breaks });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, entry } = req.body || {};
    if (action !== 'add') { res.status(400).json({ error: 'Unbekannte Aktion: ' + action }); return; }
    if (!entry || !entry.uid || typeof entry.duration !== 'number' || !entry.start || !entry.end) {
      res.status(400).json({ error: 'entry (uid, start, end, duration) fehlt oder unvollständig.' }); return;
    }

    const clean = { uid: entry.uid, start: entry.start, end: entry.end, duration: entry.duration };
    await r.rpush(KEY, JSON.stringify(clean));
    const breaks = await getAll(r);
    res.status(200).json({ ok: true, breaks });
  } catch (e) {
    console.error('[breaks]', e.message);
    res.status(500).json({ error: e.message });
  }
};
