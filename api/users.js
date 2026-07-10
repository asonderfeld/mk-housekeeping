// MK Housekeeping — Benutzerverwaltung (Vercel Serverless Function)
// Speichert Benutzer als Redis-Hash (hk:users, Feld = User-Id) statt als Datei
// im GitHub-Repo. HSET/HDEL sind atomare Redis-Operationen, dadurch kein
// Read-Modify-Write-Konflikt mehr wie bei der vorherigen Git-Lösung.
//
// Sicherheits-Update: Login läuft jetzt über die Aktion "login" hier auf dem
// Server (bcrypt-Vergleich), statt dass der Client die komplette Nutzerliste
// inkl. Klartext-Passwort lädt und lokal vergleicht. GET liefert nie mehr das
// Passwort-Feld aus. Anlegen/Löschen/Ändern verlangt eine gültige Session
// (siehe _auth.js) — Anlegen/Löschen nur mit Rolle "admin", Ändern nur durch
// Admins oder durch den Benutzer selbst (dann ausschließlich das Feld "lang").
const bcrypt = require('bcryptjs');
const { redis, parseVal } = require('./_redis');
const { createSession, destroySession, getSession, tokenFromReq } = require('./_auth');

const KEY = 'hk:users';

// Einmalige Startbefüllung, falls die Redis-DB noch leer ist (Migration von
// der alten users.json — diese 10 Einträge waren der bisherige Datenstand).
// Die Passwörter hier sind die bisherigen Klartext-Werte; sie werden vor dem
// Schreiben nach Redis gehasht (siehe seedUsers), landen also nie im Klartext
// in der Datenbank.
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

function stripPass(u) {
  if (!u) return u;
  const { pass, ...rest } = u;
  return rest;
}

function isHashed(pass) {
  return typeof pass === 'string' && /^\$2[aby]\$/.test(pass);
}

async function seedUsers(r) {
  const pipe = r.pipeline();
  SEED_USERS.forEach(u => {
    const hashed = Object.assign({}, u, { pass: bcrypt.hashSync(u.pass, 10) });
    pipe.hset(KEY, { [u.id]: JSON.stringify(hashed) });
  });
  await pipe.exec();
}

// Liefert die Rohliste inkl. gehashtem Passwort — nur für internen Gebrauch
// (Login-Vergleich). Für alles, was an den Client geht, stripPass() nutzen.
async function getAllUsersRaw(r) {
  const map = await r.hgetall(KEY);
  if (!map || Object.keys(map).length === 0) {
    await seedUsers(r);
    const map2 = await r.hgetall(KEY);
    return Object.values(map2).map(parseVal);
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
      const users = (await getAllUsersRaw(r)).map(stripPass);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, user, id } = req.body || {};
    const token = tokenFromReq(req);

    if (action === 'login') {
      const { id: loginId, pass } = req.body || {};
      if (!loginId || !pass) { res.status(400).json({ error: 'Benutzername und Passwort erforderlich.' }); return; }
      const all = await getAllUsersRaw(r);
      const found = all.find(u => u.id.toLowerCase() === String(loginId).toLowerCase()
        || u.name.toLowerCase() === String(loginId).toLowerCase()
        || u.name.split(' ')[0].toLowerCase() === String(loginId).toLowerCase());
      // Bei alten, noch nicht migrierten Einträgen (sollte nach dem Seed nicht
      // mehr vorkommen) auf Klartextvergleich zurückfallen, sonst bcrypt.
      const ok = found && (isHashed(found.pass) ? bcrypt.compareSync(pass, found.pass) : found.pass === pass);
      if (!ok) { res.status(401).json({ error: 'Benutzername oder Passwort falsch.' }); return; }
      const sessToken = await createSession(r, found);
      res.status(200).json({ ok: true, user: stripPass(found), token: sessToken });
      return;
    }

    if (action === 'logout') {
      await destroySession(r, token);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'whoami') {
      const session = await getSession(r, token);
      if (!session) { res.status(401).json({ error: 'Sitzung abgelaufen, bitte erneut anmelden.' }); return; }
      const all = await getAllUsersRaw(r);
      const found = all.find(u => u.id === session.id);
      if (!found) { res.status(401).json({ error: 'Benutzer nicht gefunden.' }); return; }
      res.status(200).json({ ok: true, user: stripPass(found) });
      return;
    }

    if (action === 'create') {
      const session = await getSession(r, token);
      if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Nur Admins dürfen Benutzer anlegen.' }); return; }
      if (!user || !user.id || !user.pass || !user.name || !user.role) {
        res.status(400).json({ error: 'Benutzername, Name, Passwort und Rolle sind erforderlich.' }); return;
      }
      const all = await getAllUsersRaw(r);
      if (all.some(u => u.id.toLowerCase() === String(user.id).toLowerCase())) {
        res.status(409).json({ error: 'Dieser Benutzername existiert bereits.' }); return;
      }
      const toStore = Object.assign({}, user, { pass: bcrypt.hashSync(user.pass, 10) });
      await r.hset(KEY, { [user.id]: JSON.stringify(toStore) });
      const users = (await getAllUsersRaw(r)).map(stripPass);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (action === 'delete') {
      const session = await getSession(r, token);
      if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Nur Admins dürfen Benutzer löschen.' }); return; }
      if (!id) { res.status(400).json({ error: '"id" fehlt' }); return; }
      const existing = await r.hget(KEY, id);
      if (existing === null || existing === undefined) { res.status(404).json({ error: 'User nicht gefunden' }); return; }
      await r.hdel(KEY, id);
      const users = (await getAllUsersRaw(r)).map(stripPass);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (action === 'update') {
      const session = await getSession(r, token);
      if (!session) { res.status(401).json({ error: 'Bitte erneut anmelden.' }); return; }
      if (!user || !user.id) { res.status(400).json({ error: 'user.id fehlt' }); return; }

      const isAdmin = session.role === 'admin';
      const isSelf = session.id === user.id;
      if (!isAdmin && !isSelf) { res.status(403).json({ error: 'Keine Berechtigung.' }); return; }

      // Nicht-Admins dürfen (auch bei sich selbst) nur die Sprache ändern —
      // sonst könnte sich z.B. ein Housekeeper selbst zum Admin machen.
      const patch = isAdmin ? user : { id: user.id, lang: user.lang };

      const existing = await r.hget(KEY, user.id);
      if (existing === null || existing === undefined) { res.status(404).json({ error: 'User nicht gefunden' }); return; }
      const existingParsed = parseVal(existing);
      const merged = Object.assign({}, existingParsed, patch);
      if (patch.pass) merged.pass = bcrypt.hashSync(patch.pass, 10);
      await r.hset(KEY, { [user.id]: JSON.stringify(merged) });
      const users = (await getAllUsersRaw(r)).map(stripPass);
      res.status(200).json({ ok: true, users });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[users]', e.message);
    res.status(500).json({ error: e.message });
  }
};
