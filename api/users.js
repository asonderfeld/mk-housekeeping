// MK Housekeeping — Benutzerverwaltung (Vercel Serverless Function)
// Liest/schreibt users.json direkt im GitHub-Repo, damit neu angelegte
// Benutzer dauerhaft gespeichert werden (Git-Commit löst Vercel-Redeploy aus).
const https = require('https');

const GH_HOST   = 'api.github.com';
const GH_TOKEN  = process.env.GH_TOKEN;
const REPO      = 'mk-housekeeping';
const FILE_PATH = 'users.json';

function ghReq(path, method, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: GH_HOST, path, method,
      headers: Object.assign({
        'Authorization': 'token ' + GH_TOKEN,
        'User-Agent': 'mk-housekeeping-app',
        'Accept': 'application/vnd.github+json',
      }, bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json; try { json = data ? JSON.parse(data) : {}; } catch (e) { json = { raw: data }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getOwner() {
  const r = await ghReq('/user', 'GET');
  if (r.status !== 200) throw new Error('GitHub-Login fehlgeschlagen: ' + (r.json.message || r.status));
  return r.json.login;
}

async function getUsersFile(owner) {
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'GET');
  if (r.status !== 200) throw new Error('users.json konnte nicht gelesen werden: ' + (r.json.message || r.status));
  const content = Buffer.from(r.json.content, 'base64').toString('utf8');
  return { sha: r.json.sha, users: JSON.parse(content) };
}

async function saveUsersFile(owner, sha, users, message) {
  const content = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'PUT', { message, content, sha });
  if (r.status !== 200 && r.status !== 201) throw new Error('users.json konnte nicht gespeichert werden: ' + (r.json.message || r.status));
  return r.json;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (!GH_TOKEN) { res.status(500).json({ error: 'GH_TOKEN fehlt in den Vercel Environment Variables.' }); return; }
    const owner = await getOwner();

    if (req.method === 'GET') {
      const { users } = await getUsersFile(owner);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, user, id } = req.body || {};
    const { sha, users } = await getUsersFile(owner);

    if (action === 'create') {
      if (!user || !user.id || !user.pass || !user.name || !user.role) {
        res.status(400).json({ error: 'Benutzername, Name, Passwort und Rolle sind erforderlich.' }); return;
      }
      if (users.some(u => u.id.toLowerCase() === String(user.id).toLowerCase())) {
        res.status(409).json({ error: 'Dieser Benutzername existiert bereits.' }); return;
      }
      users.push(user);
      await saveUsersFile(owner, sha, users, 'users.json: add ' + user.id);
      res.status(200).json({ ok: true, users });
      return;
    }

    if (action === 'delete') {
      if (!id) { res.status(400).json({ error: '"id" fehlt' }); return; }
      const next = users.filter(u => u.id !== id);
      if (next.length === users.length) { res.status(404).json({ error: 'User nicht gefunden' }); return; }
      await saveUsersFile(owner, sha, next, 'users.json: remove ' + id);
      res.status(200).json({ ok: true, users: next });
      return;
    }

    if (action === 'update') {
      if (!user || !user.id) { res.status(400).json({ error: 'user.id fehlt' }); return; }
      let found = false;
      const next = users.map(u => { if (u.id === user.id) { found = true; return Object.assign({}, u, user); } return u; });
      if (!found) { res.status(404).json({ error: 'User nicht gefunden' }); return; }
      await saveUsersFile(owner, sha, next, 'users.json: update ' + user.id);
      res.status(200).json({ ok: true, users: next });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[users]', e.message);
    res.status(500).json({ error: e.message });
  }
};
