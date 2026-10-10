// Public-page smoke check only: never submits credentials or downloads patient data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CareLinkSession, browserOptions } from '../server/carelink.mjs';

const session = new CareLinkSession({ launch: () => chromium.launch(browserOptions({ headless: true })) });
const credentials = { country: 'România', username: '', password: '' };
try {
  session.startLogin(credentials);
  const deadline = Date.now() + 60000;
  while (!['awaiting_login', 'error'].includes(session.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(session.state, 'awaiting_login', session.message);
  await session.page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(new URL(session.page.url()).hostname, 'carelink-login.minimed.eu');
  assert.ok(await session.page.locator('#password').isVisible());
  assert.ok(await session.page.getByRole('button', { name: 'Conectare', exact: true }).isVisible());
  console.log('CareLink România: țara a fost selectată și formularul oficial de autentificare este vizibil.');
  console.log('Nu au fost trimise credențiale. Exportul după autentificare necesită verificare cu un cont real.');
} finally { await session.disconnect(); }
