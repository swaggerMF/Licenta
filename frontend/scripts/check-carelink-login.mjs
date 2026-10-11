// Public-page smoke check only: never submits credentials or downloads patient data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CareLinkSession, browserOptions } from '../server/carelink.mjs';

const session = new CareLinkSession({ launch: () => chromium.launch(browserOptions({ headless: true })) });
const credentials = {};
try {
  session.startLogin(credentials);
  const deadline = Date.now() + 60000;
  while (!['awaiting_login', 'error'].includes(session.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(session.state, 'awaiting_login', session.message);
  await session.page.locator('#landing-login-button-id').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(new URL(session.page.url()).pathname, '/app/login');
  console.log('Pagina oficială CareLink este deschisă. Țara, limba și autentificarea rămân la alegerea utilizatorului.');
  console.log('Nu au fost apăsate butoane, acceptate mesaje sau trimise credențiale.');
} finally { await session.disconnect(); }
