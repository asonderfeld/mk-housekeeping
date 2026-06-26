// MK Housekeeping — Aufdoppeln-Status (Vercel Serverless Function)
// Liest/schreibt doubleups.json direkt im GitHub-Repo, damit "Zimmer muss
// aufgedoppelt werden"-Markierungen dauerhaft gespeichert werden
// (Git-Commit löst Vercel-Redeploy aus). Reset erst bei der nächsten
// Zimmerreinigung nach Abschluss der Runde, für die markiert wurde.
const https = require('https');

const GH_HOST   = 'api.github.com';
const GH_TOKEN  = process.env.GH_TOKEN;
const REPO      = 'mk-housekeeping';
const FILE_PATH = 'doubleups.json';

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

async function getFile(owner) {
  const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'GET');
  if (r.status !== 200) throw new Error('doubleups.json konnte nicht gelesen werden: ' + (r.json.message || r.status));
  const content = Buffer.from(r.json.content, 'base64').toString('utf8');
  let data; try { data = JSON.parse(content); } catch (e) { data = {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  return { sha: r.json.sha, data };
}

// Schreibt mit Retry: liest bei jedem Versuch die aktuelle Datei + SHA neu ein
// und wendet die Mutation darauf an. Verhindert "sha does not match"-Fehler,
// wenn zwei Speichervorgänge (z.B. zwei schnelle Klicks) sich überlappen.
async function saveWithRetry(owner, mutate, message, maxAttempts = 6) {
  let lastMsg = '';
  for (let i = 0; i < maxAttempts; i++) {
    const { sha, data } = await getFile(owner);
    const next = mutate(data);
    const content = Buffer.from(JSON.stringify(next, null, 2)).toString('base64');
    const r = await ghReq(`/repos/${owner}/${REPO}/contents/${FILE_PATH}`, 'PUT', { message, content, sha });
    if (r.status === 200 || r.status === 201) return next;
    lastMsg = (r.json && r.json.message) || String(r.status);
    if (r.status === 409 || r.status === 422 || /does not match|sha|expected|is at/i.test(lastMsg)) {
      await new Promise(res => setTimeout(res, 200 + i * 150));
      continue;
    }
    throw new Error('doubleups.json konnte nicht gespeichert werden: ' + lastMsg);
  }
  throw new Error('doubleups.json: Konflikt nach mehreren Versuchen (gleichzeitige Änderung). ' + lastMsg);
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
      const { data } = await getFile(owner);
      res.status(200).json({ ok: true, doubleUps: data });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const { action, key, types, locked, need } = req.body || {};
    if (!key) { res.status(400).json({ error: '"key" fehlt' }); return; }

    if (action === 'set') {
      const next = await saveWithRetry(owner, data => {
        const copy = Object.assign({}, data);
        copy[key] = { types: Array.isArray(types) ? types : [], locked: !!locked, need: !!need };
        return copy;
      }, 'doubleups.json: set ' + key);
      res.status(200).json({ ok: true, doubleUps: next });
      return;
    }

    if (action === 'clear') {
      const next = await saveWithRetry(owner, data => {
        const copy = Object.assign({}, data);
        delete copy[key];
        return copy;
      }, 'doubleups.json: clear ' + key);
      res.status(200).json({ ok: true, doubleUps: next });
      return;
    }

    res.status(400).json({ error: 'Unbekannte Aktion: ' + action });
  } catch (e) {
    console.error('[doubleups]', e.message);
    res.status(500).json({ error: e.message });
  }
};
