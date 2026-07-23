// MK Housekeeping — Gast-Wunschreinigung (Vercel Serverless Function)
// Speichert Zimmer, für die ein Gast per QR-Code eine (Zwischen-)Reinigung
// angefordert hat, als Redis-Hash (hk:guestclean). Öffentlich erreichbar
// (kein Login nötig) — guest.html ruft "request" direkt vom Gast-Handy auf.
// Das Frontend (index.html) mischt diese Einträge in die ZR-Logik (isZR)
// und löscht den Eintrag automatisch, sobald das Zimmer als
// "CleanToBeInspected" markiert wird (siehe ev_inspect).
const { redis, parseVal } = require('./_redis');

const KEY = 'hk:guestclean';

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
      const guestClean = await getAll(r);
      res.status(200).json({ ok: true, guestClean });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, key, prop, room } = req.body || {};

    if (action === 'request') {
      const k = key || (prop && room ? prop + '_' + room : null);
      if (!k) { res.status(400).json({ error: '"key" oder "prop"+"room" fehlt' }); return; }
      await r.hset(KEY, { [k]: JSON.stringify({ ts: Date.now() }) });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'clear') {
      if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }
      await r.hdel(KEY, key);
      const guestClean = await getAll(r);
      res.status(200).json({ ok: true, guestClean });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[guestclean]', e.message);
    res.status(500).json({ error: e.message });
  }
};
