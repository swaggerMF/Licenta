import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions, CareLinkSession } from './carelink.mjs';
import { createAppServer } from './index.mjs';

async function fixture(t) {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route('https://carelink.minimed.eu/**', route => route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname === '/app/reports' ? '<main><button>Reports</button></main>' : '<!doctype html><html><body></body></html>' }));
  const page = await context.newPage();
  await page.goto('https://carelink.minimed.eu/app/dashboard');
  const session = new CareLinkSession();
  session.browser = browser; session.context = context; session.page = page; session.state = 'awaiting_login';
  return { page, context, session };
}

test('login leaves warnings, country, language, credentials and consent to the user', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  const session = new CareLinkSession({ launch: async () => browser });
  t.after(() => session.disconnect());
  // Serve only a synthetic login page; no real authentication occurs.
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await originalNewContext(options);
    await context.route('https://carelink.minimed.com/**', route => route.fulfill({ contentType: 'text/html', body: `
      <button id="btn-unsupported-close" onclick="window.touched = true">Accept warning</button>
      <select aria-label="Country" onchange="window.touched = true"><option>Italia</option><option>România</option></select>
      <select aria-label="Language" onchange="window.touched = true"><option>Italiano</option><option>English</option></select>
      <input name="username"><input type="password">
      <button id="landing-login-button-id" onclick="window.touched = true">Sign in</button>` }));
    return context;
  };
  await session.connect({ country: 'România', username: 'example', password: 'secret' }, session.generation);
  const page = session.page;
  assert.equal(session.state, 'awaiting_login');
  assert.equal(await page.evaluate(() => Boolean(window.touched)), false);
  assert.equal(await page.getByLabel('Country').inputValue(), 'Italia');
  assert.equal(await page.getByLabel('Language').inputValue(), 'Italiano');
  assert.equal(await page.locator('input[name="username"]').inputValue(), '');
  assert.equal(await page.locator('input[type="password"]').inputValue(), '');
  await page.goto('https://carelink.minimed.com/app/dashboard');
  await page.setContent('<main>Dashboard</main><div role="dialog"><button onclick="this.parentElement.remove()">Accept terms</button></div>');
  assert.equal(await session.checkLogin(), false);
  assert.equal(session.authenticated, undefined);
});

test('EU dashboard is detected without an English Reports button; login forms and empty shells are rejected', async t => {
  const { page, session } = await fixture(t);
  assert.equal(await session.checkLogin(), false);
  await page.setContent('<main><input type="password"><h1>Dashboard</h1></main>');
  assert.equal(await session.checkLogin(), false);
  await page.setContent('<main><h1>Dashboard</h1></main>');
  session.addEntries([{ date: '2026-10-10', time: '12:00:00', bg: 120, event: 'NONE' }]);
  await session.watchLogin(session.generation);
  assert.equal(session.status().authenticated, true);
  assert.equal(page.url(), 'https://carelink.minimed.eu/app/reports');
  assert.equal(session.state, 'connected');
  assert.equal(session.entries.length, 1);
  assert.equal(session.revision, 1); // Login detection never starts an export.
});

test('localized menus, hidden desktop copies and trusted embedded report pages are detected', async t => {
  const { page, session } = await fixture(t);
  await page.goto('https://carelink.minimed.eu/patient/home');
  await page.setContent('<button style="display:none">Reports</button><div role="menuitem">Rapporti</div>');
  assert.equal(await session.checkLogin(), true);
  await page.setContent('<button aria-label="Esci">×</button>');
  assert.equal(await session.checkLogin(), true);
  await page.setContent('<iframe src="/app/reports"></iframe>');
  const frame = page.frames().find(frame => frame !== page.mainFrame());
  await frame.waitForLoadState();
  await frame.locator('body').evaluate(body => { body.innerHTML = '<span>Rapoarte</span>'; });
  assert.equal(await session.checkLogin(), true);
  assert.equal(session.reportView, frame);
  await page.goto('https://carelink.minimed.eu/app/login');
  await page.setContent('<button id="landing-login-button-id">Login</button><span>Reports</span>');
  assert.equal(await session.checkLogin(), false);
});

test('status polling and the manual check recover a missed login without resubmitting credentials', async t => {
  const { page, session } = await fixture(t);
  const app = createAppServer({ connector: session });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const initial = await fetch(`${base}/api/carelink/status`);
  const headers = { Origin: base, Cookie: initial.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  assert.equal((await initial.json()).authenticated, false);
  const failed = await fetch(`${base}/api/carelink/check-login`, { method: 'POST', headers, body: '{}' });
  assert.equal((await failed.json()).authenticated, false);
  await page.setContent('<main><h1>Dashboard</h1></main>');
  const polled = await fetch(`${base}/api/carelink/status`, { headers });
  assert.equal((await polled.json()).authenticated, true);
  const checked = await fetch(`${base}/api/carelink/check-login`, { method: 'POST', headers, body: '{}' });
  assert.equal((await checked.json()).state, 'connected');
  assert.equal(session.revision, 0);
});


test('only the first successful login minimizes the owned CareLink window', async t => {
  const { page, context, session } = await fixture(t);
  const commands = [];
  context.newCDPSession = async target => {
    assert.equal(target, page);
    return {
      async send(command, parameters) { commands.push([command, parameters]); return { windowId: 42 }; },
      async detach() { commands.push(['detach']); },
    };
  };
  await page.setContent('<input type="password">');
  assert.equal(await session.checkLogin(), false);
  assert.deepEqual(commands, []);
  await page.setContent('<main>Dashboard</main>');
  assert.equal(await session.checkLogin(), true);
  assert.deepEqual(commands, [
    ['Browser.getWindowForTarget', undefined],
    ['Browser.setWindowBounds', { windowId: 42, bounds: { windowState: 'minimized' } }],
    ['detach'],
  ]);
  assert.equal(await session.checkLogin(), true);
  assert.equal(commands.length, 3);
  assert.equal(session.status().windowBackgrounded, true);
});
