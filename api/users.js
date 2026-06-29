// MK Housekeeping — Benutzerverwaltung (Vercel Serverless Function)
// Speichert Benutzer als Redis-Hash (hk:users, Feld = User-Id) statt als Datei
// im GitHub-Repo. HSET/HDEL sind atomare Redis-Operationen, dadurch kein
// Read-Modify-Write-Konflikt mehr wie bei der vorherigen Git-Lösung.
const { redis, parseVal } = require('./_redis');

const KEY = 'hk:users';

// Einmalige Startbefüllung, falls die Redis-DB noch leer ist (Migration von
// der alten users.json — diese 10 Einträge waren der bisherige Datenstand).
const SEED_USERS = [
  { id: 'AS', name: 'Arno Sonderfeld', role: 'admin', props: ['alle'], bg: '#B5D4F4', tx: '#0C447C', pass: 'AS' },
  { id: 'LD', name: 'Lena Dressler', role: 'admin', props: ['STGR', 'SPHMK'], bg: '#B5D4F4', tx: '#0C447C', pass: 'LD2026' },
  { id: 'MK', name: 'Maria K.', role: 'housekeeper', props: ['STGR'], bg: '#EEEDFE', tx: '#534AB7', pass: 'MK2026' },
  { id: 'AW', name: 'Anna W.', role: 'housekeeper', props: ['STGR', 'SPHMK'], bg: '#9FE1CB', tx: '#085041', pass: 'AW2026' },
  { id: 'TE', name: 'Tanja E.', role: 'housekeeper', props: ['EBO', 'ARNS'], bg: '#FAC775', tx: '#633806', pass: 'TE2026' },
  { id: 'VM', name: 'Vera M.', role: 'housekeeper', props: ['TIA'], bg: '#F5C4B3', tx: '#712B13', pass: 'VM2026' },
  { id: 'BN', name: 'Beata N.', role: 'housekeeper', props: ['MUC_CTY', 'MUC_MWP'], bg: '#C0DD97', tx: '#27500A', pass: 'BN2026' },
  { id: 'SR', name: 'Sandra R.', role: 'housekeeper', props: ['BER', 'FRA'], bg: '#FBEAF0', tx: '#993556', pass: 'SR2026' },
  { id: 'HM', name: 'Hana M.', role: 'housekeeper', props: ['REM', 'RUE'], bg: '#E6F1FB', tx: '#185FA5', pass: 'HM2026' },
  { id: 'EW', name: 'Eva W.', role: 'housekeeper', props: ['ZPF', 'LON'], bg: '#EEEDFE', tx: '#3C3489', pass: 'EW2026' },
];

async function getAllUsers(r) {
  const map = await r.hgetall(KEY);
  if (!map || Object.keys(map).length === 0) {
    const pipe = r.pipeline();
    SEED_USERS.forEach(u => pipe.hset(KEY, { [u.id]: JSON.stringify(u) }));
    await pipe.exec();
    return SEED_USERS.slice();
  }
  return Object.values(map).map(parseVal);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const r = redis();

    if (req.method === 'GET') {
      const users = await getAllUsers(r);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, user, id } = req.body || {};

    if (action === 'create') {
      if (!user || !user.id || !user.pass || !user.name || !user.role) {
        res.status(400).json({ error: 'Benutzername, Name, Passwort und Rolle sind erforderlich.' }); return;
      }
      const all = await getAllUsers(r);
      if (all.some(u => u.id.toLowerCase() === String(user.id).toLowerCase())) {
        res.status(409).json({ error: 'Dieser Benutzername existiert bereits.' }); return;
      }
      await r.hset(KEY, { [user.id]: JSON.stringify(user) });
      const users = await getAllUsers(r);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (action === 'delete') {
      if (!id) { res.status(400).json({ error: '"id" fehlt' }); return; }
      const existing = await r.hget(KEY, id);
      if (existing === null || existing === undefined) { res.status(404).json({ error: 'User nicht gefunden' }); return; }
      await r.hdel(KEY, id);
      const users = await getAllUsers(r);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (action === 'update') {
      if (!user || !user.id) { res.status(400).json({ error: 'user.id fehlt' }); return; }
      const existing = await r.hget(KEY, user.id);
      if (existing === null || existing === undefined) { res.status(404).json({ error: 'User nicht gefunden' }); return; }
      const merged = Object.assign({}, parseVal(existing), user);
      await r.hset(KEY, { [user.id]: JSON.stringify(merged) });
      const users = await getAllUsers(r);
      res.status(200).json({ ok: true, users });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[users]', e.message);
    res.status(500).json({ error: e.message });
  }
};
