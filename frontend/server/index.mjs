import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CareLinkSession } from './carelink.mjs';
import { parseCsvText } from './parser.mjs';

const MAX_BODY = 20 * 1024 * 1024;

function respond(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}

export function allowedOrigin(origin, port) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && [String(port), '5173', '4173'].includes(url.port) && url.origin === origin;
  } catch { return false; }
}

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new Error('Trimite datele în format JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Fișierul sau cererea depășește limita de 20 MB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Cerere JSON invalidă.'); }
}

export function createAppServer({ connector = new CareLinkSession(), parseCsv = parseCsvText } = {}) {
  // One local browser/session per running application. Never expose this service publicly.
  let token = null;
  const server = createServer(async (request, response) => {
    const port = server.address()?.port;
    const host = request.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return respond(response, 403, { error: 'Host nepermis.' });
    if (request.headers.origin && !allowedOrigin(request.headers.origin, port)) return respond(response, 403, { error: 'Origine nepermisă.' });
    const pathname = new URL(request.url, `http://${host}`).pathname;
    const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('carelink_session='))?.slice('carelink_session='.length);
    const authorized = token && /^[a-f0-9]{64}$/.test(cookie || '') && timingSafeEqual(Buffer.from(cookie), Buffer.from(token));
    if (request.method === 'GET' && pathname === '/api/carelink/status' && !token) {
      token = randomBytes(32).toString('hex');
      response.setHeader('Set-Cookie', `carelink_session=${token}; HttpOnly; SameSite=Strict; Path=/api`);
      return respond(response, 200, connector.status());
    }
    if (!authorized) return respond(response, 401, { error: 'Sesiune locală indisponibilă. Reîncarcă pagina; după repornirea serverului, reîncearcă.' });
    if (!['GET', 'POST'].includes(request.method)) return respond(response, 405, { error: 'Metodă nepermisă.' });
    if (request.method === 'POST' && !allowedOrigin(request.headers.origin, port)) return respond(response, 403, { error: 'Origine obligatorie pentru această operație.' });
    try {
      if (request.method === 'GET' && pathname === '/api/carelink/status') return respond(response, 200, connector.status());
      if (request.method === 'GET' && pathname === '/api/carelink/entries') return respond(response, 200, { entries: connector.entries, revision: connector.revision, dataVersion: connector.dataVersion, importedLatest: connector.importedLatest });
      if (request.method === 'POST' && pathname === '/api/carelink/normal-login') {
        await connector.startNormalLogin();
        return respond(response, 200, connector.status());
      }
      if (request.method === 'POST' && pathname === '/api/carelink/login') {
        const body = await readJson(request);
        if (typeof body.country !== 'string' || !body.country.trim() || body.country.length > 100) throw new Error('Selectează țara contului CareLink.');
        const username = body.username ?? '';
        const password = body.password ?? '';
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 320 || password.length > 1024) throw new Error('Date de autentificare invalide.');
        if (Boolean(username) !== Boolean(password)) throw new Error('Completează utilizatorul și parola sau lasă ambele câmpuri goale pentru autentificare în CareLink.');
        connector.startLogin({ country: body.country.trim(), username, password });
        body.password = '';
        return respond(response, 202, connector.status());
      }
      if (request.method === 'POST' && pathname === '/api/carelink/sync') {
        if (!connector.context && !connector.normalMode) throw new Error('Conectează-te mai întâi la CareLink.');
        connector.sync().catch(() => {});
        return respond(response, 202, connector.status());
      }
      if (request.method === 'POST' && pathname === '/api/carelink/disconnect') {
        await connector.disconnect();
        return respond(response, 200, connector.status());
      }
      if (request.method === 'POST' && pathname === '/api/import') {
        const body = await readJson(request);
        if (typeof body.csv !== 'string') throw new Error('Lipsește fișierul CSV.');
        try {
          const entries = await parseCsv(body.csv);
          connector.addEntries(entries);
          return respond(response, 200, { entries: connector.entries, importedLatest: connector.importedLatest });
        }
        catch { return respond(response, 422, { error: 'CSV-ul nu a putut fi procesat de parserul C++. Verifică formatul exportului și compilatorul g++.' }); }
      }
      return respond(response, 404, { error: 'Rută inexistentă.' });
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  });
  return { server, close: async () => { await connector.disconnect(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CARELINK_PORT || 3001);
  const app = createAppServer();
  app.server.listen(port, '127.0.0.1', () => console.log(`CareLink local: http://127.0.0.1:${port}`));
  app.server.on('error', error => { console.error(`Serverul CareLink nu poate porni (${error.code}).`); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
