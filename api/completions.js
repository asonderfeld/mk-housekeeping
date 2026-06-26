// MK Housekeeping — Reinigungsstatistik (Vercel Serverless Function)
// Liest/schreibt completions.json direkt im GitHub-Repo, damit abgeschlossene
// Reinigungen dauerhaft gespeichert werden (Git-Commit löst Vercel-Redeploy aus).
const https = require('https');

const GH_HOST   = 'api.github.com';
const GH_TOKEN  = process.env.GH_TOKEN;
const REPO      = 'mk-housekeeping';
const FILE_PATH = 'completions.json';

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

async function getCompletionsFile(owner) {
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'GET');
  if (r.status !== 200) throw new Error('completions.json konnte nicht gelesen werden: ' + (r.json.message || r.status));
  const content = Buffer.from(r.json.content, 'base64').toString('utf8');
  let completions; try { completions = JSON.parse(content); } catch (e) { completions = []; }
  if (!Array.isArray(completions)) completions = [];
  return { sha: r.json.sha, completions };
}

async function saveCompletionsFile(owner, sha, completions, message) {
  const content = Buffer.from(JSON.stringify(completions, null, 2)).toString('base64');
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'PUT', { message, content, sha });
  if (r.status !== 200 && r.status !== 201) throw new Error('completions.json konnte nicht gespeichert werden: ' + (r.json.message || r.status));
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
      const { completions } = await getCompletionsFile(owner);
      res.status(200).json({ ok: true, completions });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, entry } = req.body || {};
    if (action !== 'add') { res.status(400).json({ error: 'Unbekannte Aktion: ' + action }); return; }
    if (!entry || !entry.uid || !entry.prop || !entry.room || typeof entry.duration !== 'number' || !entry.ts) {
      res.status(400).json({ error: 'entry (uid, prop, room, duration, ts) fehlt oder unvollständig.' }); return;
    }

    const { sha, completions } = await getCompletionsFile(owner);
    completions.push({ uid: entry.uid, prop: entry.prop, room: entry.room, duration: entry.duration, ts: entry.ts });
    await saveCompletionsFile(owner, sha, completions, 'completions.json: add ' + entry.prop + '_' + entry.room + ' @ ' + entry.ts);
    res.status(200).json({ ok: true, completions });
  } catch (e) {
    console.error('[completions]', e.message);
    res.status(500).json({ error: e.message });
  }
};
