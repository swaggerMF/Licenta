import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './carelink.mjs';
import { activateControl } from './controls.mjs';

test('background activation does not require animation stability and respects disabled controls', async t => {
  const browser = await chromium.launch(browserOptions({ headless: true }));
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<style>
    @keyframes moving { from { transform:translateX(0); } to { transform:translateX(100px); } }
    button { animation:moving 100ms infinite alternate linear; }
  </style><button onclick="window.clicked = (window.clicked || 0) + 1">Calendar</button>`);
  const control = page.getByRole('button', { name: 'Calendar' });
  await activateControl(control, { background: true });
  assert.equal(await page.evaluate(() => window.clicked), 1);
  await control.evaluate(element => { element.disabled = true; });
  await assert.rejects(activateControl(control, { background: true }), /dezactivat/);
  await control.evaluate(element => { element.disabled = false; element.setAttribute('aria-disabled', 'true'); });
  await assert.rejects(activateControl(control, { background: true }), /dezactivat/);
  assert.equal(await page.evaluate(() => window.clicked), 1);
});
