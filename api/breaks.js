// MK Housekeeping — Pausen-Log (Vercel Serverless Function)
// Liest/schreibt breaks.json direkt im GitHub-Repo, damit Pausen der
// Zimmermädchen dauerhaft gespeichert werden (Git-Commit löst Vercel-Redeploy aus).
const https = require('https');

const GH_HOST   = 'api.github.com';
const GH_TOKEN  = process.env.GH_TOKEN;
const REPO      = 'mk-housekeeping';
const FILE_PATH = 'breaks.json';

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

async function getBreaksFile(owner) {
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'GET');
  if (r.status !== 200) throw new Error('breaks.json konnte nicht gelesen werden: ' + (r.json.message || r.status));
  const content = Buffer.from(r.json.content, 'base64').toString('utf8');
  let breaks; try { breaks = JSON.parse(content); } catch (e) { breaks = []; }
  if (!Array.isArray(breaks)) breaks = [];
  return { sha: r.json.sha, breaks };
}

async function saveBreaksFile(owner, sha, breaks, message) {
  const content = Buffer.from(JSON.stringify(breaks, null, 2)).toString('base64');
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'PUT', { message, content, sha });
  if (r.status !== 200 && r.status !== 201) throw new Error('breaks.json konnte nicht gespeichert werden: ' + (r.json.message || r.status));
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
      const { breaks } = await getBreaksFile(owner);
      res.status(200).json({ ok: true, breaks });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, entry } = req.body || {};
    if (action !== 'add') { res.status(400).json({ error: 'Unbekannte Aktion: ' + action }); return; }
    if (!entry || !entry.uid || typeof entry.duration !== 'number' || !entry.start || !entry.end) {
      res.status(400).json({ error: 'entry (uid, start, end, duration) fehlt oder unvollständig.' }); return;
    }

    const { sha, breaks } = await getBreaksFile(owner);
    breaks.push({ uid: entry.uid, start: entry.start, end: entry.end, duration: entry.duration });
    await saveBreaksFile(owner, sha, breaks, 'breaks.json: add ' + entry.uid + ' @ ' + entry.start);
    res.status(200).json({ ok: true, breaks });
  } catch (e) {
    console.error('[breaks]', e.message);
    res.status(500).json({ error: e.message });
  }
};
