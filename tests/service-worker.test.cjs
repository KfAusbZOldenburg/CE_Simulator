const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');

test('service worker bypasses cross-origin requests', () => {
  const handlers = {};
  vm.runInNewContext(serviceWorker, {
    URL,
    self: { location: { origin: 'https://kfausbzoldenburg.github.io' },
      addEventListener(name, handler) { handlers[name] = handler; } },
    fetch() { throw new Error('External request must reach the browser directly'); }
  });
  for (const url of ['https://script.google.com/macros/s/example/exec',
    'https://script.googleusercontent.com/result']) {
    handlers.fetch({ request: { method: 'GET', url },
      respondWith() { assert.fail('Must not substitute cached HTML'); } });
  }
});

test('service worker version changes so mobile clients install the fix', () => {
  assert.match(serviceWorker, /const CACHE_NAME = "ce-simultor-v0\.4\.2";/);
});

function setupLoader() {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const highscoreLoader = index.slice(index.indexOf('async function loadHighscores('), index.indexOf('function getBestHighscores('));
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const rendered = [];
  const retryButton = { hidden: true };
  const context = vm.createContext({
    AbortController,
    HIGHSCORE_URL: 'https://script.google.com/macros/s/example/exec',
    highscoreViewTaskId: 'gerade', lastResult: null,
    highscoreLoadController: null, highscoreStatus: { textContent: '' },
    document: { getElementById() { return retryButton; } },
    console: { warn() {} },
    fetch(url, options) {
      return new Promise((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    renderHighscores(list, name) { rendered.push({ list, name }); }
  });
  vm.runInContext(highscoreLoader, context);
  return { context, requests, timers, rendered, retryButton };
}

test('public JSON request omits Google cookies, follows redirects and renders personal bests', async () => {
  const { context, requests, timers, rendered, retryButton } = setupLoader();
  const pending = context.loadHighscores('Anna');
  assert.equal(new URL(requests[0].url).searchParams.get('aufgabe'), 'gerade');
  assert.equal(new URL(requests[0].url).searchParams.has('callback'), false);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.redirect, 'follow');
  assert.equal(requests[0].options.mode, 'cors');
  assert.equal(requests[0].options.cache, 'no-store');
  const data = [{ name: 'Anna', punkte: 1200 }];
  requests[0].resolve({ ok: true, json: async () => data });
  await pending;
  assert.deepEqual(rendered, [{ list: data, name: 'Anna' }]);
  assert.equal(context.highscoreStatus.textContent, '');
  assert.equal(retryButton.hidden, true);
  assert.equal(context.highscoreLoadController, null);
  assert.equal(timers.size, 0);
});

test('stalled response aborts after fifteen seconds and offers a retry', async () => {
  const { context, requests, timers, rendered, retryButton } = setupLoader();
  const pending = context.loadHighscores('');
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await pending;
  assert.match(context.highscoreStatus.textContent, /zu lange gedauert/);
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(retryButton.hidden, false);
  assert.equal(timers.size, 0);
  assert.equal(rendered.length, 0);
});

test('network, HTTP, HTML and invalid JSON replies produce a retry instead of an empty leaderboard', async () => {
  for (const outcome of [
    new Error('Network error'),
    { ok: false, status: 403 },
    { ok: true, json: async () => { throw new SyntaxError('HTML login page'); } },
    { ok: true, json: async () => ({ error: 'Access denied' }) }
  ]) {
    const { context, requests, timers, rendered, retryButton } = setupLoader();
    const pending = context.loadHighscores('');
    if (outcome instanceof Error) requests[0].reject(outcome);
    else requests[0].resolve(outcome);
    await pending;
    assert.match(context.highscoreStatus.textContent, /konnte nicht geladen werden/);
    assert.equal(retryButton.hidden, false);
    assert.equal(rendered.length, 0);
    assert.equal(timers.size, 0);
  }
});

test('retry uses the selected task and own name; empty results remain valid', async () => {
  const { context, requests, retryButton, rendered } = setupLoader();
  context.highscoreViewTaskId = 'umkehren';
  const pending = context.loadHighscores('Anna');
  requests[0].reject(new Error('Offline'));
  await pending;
  const retry = retryButton.onclick();
  assert.equal(retryButton.hidden, true);
  assert.equal(new URL(requests[1].url).searchParams.get('aufgabe'), 'umkehren');
  requests[1].resolve({ ok: true, json: async () => [] });
  await retry;
  assert.deepEqual(rendered, [{ list: [], name: 'Anna' }]);
});

test('switching tasks cancels the previous request without overwriting the new view', async () => {
  const { context, requests, rendered, timers } = setupLoader();
  const first = context.loadHighscores('');
  context.highscoreViewTaskId = 'umkehren';
  const second = context.loadHighscores('');
  await first;
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(context.highscoreStatus.textContent, 'Bestenliste wird geladen...');
  requests[1].resolve({ ok: true, json: async () => [{ name: 'Ben', punkte: 500 }] });
  await second;
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].list[0].name, 'Ben');
  assert.equal(timers.size, 0);
});
