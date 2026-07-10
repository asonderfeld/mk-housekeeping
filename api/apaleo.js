// MK Housekeeping — Apaleo API Proxy (Vercel Serverless Function)
// Sicherheits-Update: Dieser Proxy hängt das echte Apaleo-Token an, das der
// Client nie sieht — vorher konnte man mit der bloßen Vercel-URL beliebige
// Apaleo-Endpunkte lesen/schreiben (auch ohne App-Login). Jetzt: (1) nur die
// paar Pfade erlaubt, die die App tatsächlich braucht, (2) gültige App-Session
// (siehe _auth.js) erforderlich.
const https = require('https');
const { redis } = require('./_redis');
const { getSession, tokenFromReq } = require('./_auth');

const TOKEN_HOST = 'identity.apaleo.com';
const API_HOST   = 'api.apaleo.com';

// Nur diese Apaleo-Pfade nutzt die App wirklich (Zimmerliste, Belegung,
// Reservierungen, Zimmerzustand setzen). Alles andere wird abgelehnt.
const ALLOWED_PATH_PREFIXES = [
  '/inventory/v1/properties',
  '/inventory/v1/units',
  '/booking/v1/reservations',
  '/operations/v1/units-condition',
];

function isAllowedPath(pathname) {
  return ALLOWED_PATH_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

let _token = null, _tokenExp = 0;

function httpsReq(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const req = https.request({
      hostname, path, method,
      headers: Object.assign({}, headers, bodyStr ? {'Content-Length': Buffer.byteLength(bodyStr)} : {}),
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const id = process.env.APALEO_CLIENT_ID, secret = process.env.APALEO_CLIENT_SECRET;
  if (!id || !secret) throw new Error('APALEO_CLIENT_ID oder APALEO_CLIENT_SECRET fehlen in den Vercel Environment Variables.');
  const body = 'grant_type=client_credentials&client_id=' + encodeURIComponent(id) + '&client_secret=' + encodeURIComponent(secret);
  const res = await httpsReq(TOKEN_HOST, '/connect/token', 'POST', {'Content-Type': 'application/x-www-form-urlencoded'}, body);
  if (res.status !== 200) throw new Error('Token-Fehler ' + res.status + ': ' + res.body);
  const json = JSON.parse(res.body);
  _token = json.access_token;
  _tokenExp = Date.now() + (json.expires_in - 60) * 1000;
  return _token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const r = redis();
    const session = await getSession(r, tokenFromReq(req));
    if (!session) { res.status(401).json({ error: 'Bitte erneut anmelden.' }); return; }

    const { path, method = 'GET', body } = req.body || {};
    if (!path) { res.status(400).json({ error: '"path" fehlt' }); return; }
    const urlObj = new URL('https://' + API_HOST + path);
    if (!isAllowedPath(urlObj.pathname)) { res.status(403).json({ error: 'Pfad nicht erlaubt: ' + urlObj.pathname }); return; }

    const token = await getToken();
    const apiRes = await httpsReq(API_HOST, urlObj.pathname + urlObj.search, method,
      {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      body ? JSON.stringify(body) : '');
    res.status(apiRes.status).send(apiRes.body || '{}');
  } catch (e) {
    console.error('[apaleo]', e.message);
    res.status(500).json({ error: e.message });
  }
};
