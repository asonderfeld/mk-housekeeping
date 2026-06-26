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

// Schreibt mit Retry: liest bei jedem Versuch die aktuelle Datei + SHA neu ein
// und wendet die Mutation darauf an. Verhindert "sha does not match"-Fehler,
// wenn zwei Speichervorgänge sich überlappen (z.B. zwei Housekeeper gleichzeitig).
async function saveWithRetry(owner, mutate, message, maxAttempts = 6) {
  let lastMsg = '';
  for (let i = 0; i < maxAttempts; i++) {
    const { sha, completions } = await getCompletionsFile(owner);
    const next = mutate(completions);
    const content = Buffer.from(JSON.stringify(next, null, 2)).toString('base64');
    const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'PUT', { message, content, sha });
    if (r.status === 200 || r.status === 201) return next;
    lastMsg = (r.json && r.json.message) || String(r.status);
    if (r.status === 409 || r.status === 422 || /does not match|sha|expected|is at/i.test(lastMsg)) {
      await new Promise(res => setTimeout(res, 200 + i * 150));
      continue;
    }
    throw new Error('completions.json konnte nicht gespeichert werden: ' + lastMsg);
  }
  throw new Error('completions.json: Konflikt nach mehreren Versuchen (gleichzeitige Änderung). ' + lastMsg);
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

    const next = await saveWithRetry(owner, completions => {
      const copy = completions.slice();
      copy.push({ uid: entry.uid, prop: entry.prop, room: entry.room, duration: entry.duration, ts: entry.ts });
      return copy;
    }, 'completions.json: add ' + entry.prop + '_' + entry.room + ' @ ' + entry.ts);
    res.status(200).json({ ok: true, completions: next });
  } catch (e) {
    console.error('[completions]', e.message);
    res.status(500).json({ error: e.message });
  }
};
