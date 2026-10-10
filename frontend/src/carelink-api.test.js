import test from 'node:test';
import assert from 'node:assert/strict';
import { carelinkRequest } from './carelink-api.js';

test('network errors are readable and the next successful request recovers', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(carelinkRequest('/api/carelink/status'), error => {
    assert.equal(error.code, 'CONNECTION_UNAVAILABLE');
    assert.match(error.message, /serverul local/);
    assert.ok(!error.message.includes('Failed to fetch'));
    return true;
  });
  globalThis.fetch = async () => Response.json({ state: 'ready', dataVersion: 'new-export' });
  assert.equal((await carelinkRequest('/api/carelink/status')).state, 'ready');
});

test('proxy errors and invalid JSON cannot become a null session', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const response of [new Response('Proxy unavailable', { status: 502 }), Response.json(null), new Response('<html>fallback</html>')]) {
    globalThis.fetch = async () => response;
    await assert.rejects(carelinkRequest('/api/carelink/status'), { code: 'CONNECTION_UNAVAILABLE' });
  }
});

test('failed login requests are never automatically resubmitted', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new TypeError('Failed to fetch'); };
  await assert.rejects(carelinkRequest('/api/carelink/login', { country: 'România' }));
  assert.equal(attempts, 1);
});

test('application validation messages and deliberate cancellation are preserved', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ error: 'Selectează țara.' }, { status: 400 });
  await assert.rejects(carelinkRequest('/api/carelink/login', {}), /Selectează țara/);
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_path, options) => { options.signal.throwIfAborted(); };
  await assert.rejects(carelinkRequest('/api/carelink/status', undefined, controller.signal), { name: 'AbortError' });
});
