// MK Housekeeping — Reinigungsstatistik (Vercel Serverless Function)
// Speichert abgeschlossene Reinigungen als Redis-Liste (hk:completions).
// RPUSH ist atomar — kein Read-Modify-Write-Konflikt wie bei der vorherigen
// Git-Lösung, bei der jede neue Reinigung einen Commit ausgelöst hat.
const { redis, parseVal } = require('./_redis');

const KEY = 'hk:completions';

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
      const completions = await getAll(r);
      res.status(200).json({ ok: true, completions });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, entry } = req.body || {};
    if (action !== 'add') { res.status(400).json({ error: 'Unbekannte Aktion: ' + action }); return; }
    if (!entry || !entry.uid || !entry.prop || !entry.room || typeof entry.duration !== 'number' || !entry.ts) {
      res.status(400).json({ error: 'entry (uid, prop, room, duration, ts) fehlt oder unvollständig.' }); return;
    }

    // "type" ist optional: normale Reinigungsabschlüsse haben keinen Typ,
    // DNDS-Meldungen (Gast wollte keine Störung) setzen type:'dnds' mit duration:0.
    // "kind" ist optional: 'stay' (Bleibe-Reinigung, inkl. Zwangsreinigung) oder
    // 'departure' (Abreise-Reinigung) — nur bei echten Reinigungsabschlüssen gesetzt.
    const clean = { uid: entry.uid, prop: entry.prop, room: entry.room, duration: entry.duration, ts: entry.ts };
    if (entry.type === 'dnds') clean.type = 'dnds';
    if (entry.kind === 'stay' || entry.kind === 'departure') clean.kind = entry.kind;
    await r.rpush(KEY, JSON.stringify(clean));
    const completions = await getAll(r);
    res.status(200).json({ ok: true, completions });
  } catch (e) {
    console.error('[completions]', e.message);
    res.status(500).json({ error: e.message });
  }
};
