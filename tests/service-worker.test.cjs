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
  const highscoreLoader = index.slice(index.indexOf('function loadHighscores('), index.indexOf('function getBestHighscores('));
  const scripts = [];
  const timers = new Map();
  const rendered = [];
  const body = {
    appendChild(script) { script.parentNode = body; scripts.push(script); },
    removeChild(script) { scripts.splice(scripts.indexOf(script), 1); script.parentNode = null; }
  };
  const context = vm.createContext({
    HIGHSCORE_URL: 'https://script.google.com/macros/s/example/exec',
    highscoreViewTaskId: 'gerade', lastResult: null,
    highscoreStatus: { textContent: '' }, window: {},
    document: { body, createElement() { return {}; } },
    setTimeout(callback, delay) { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    renderHighscores(list, name) { rendered.push({ list, name }); }
  });
  vm.runInContext(highscoreLoader, context);
  return { context, scripts, timers, rendered };
}

test('successful response renders the list and removes script, callback and timeout', async () => {
  const { context, scripts, timers, rendered } = setupLoader();
  const pending = context.loadHighscores('Anna');
  const callbackName = new URL(scripts[0].src).searchParams.get('callback');
  assert.equal(new URL(scripts[0].src).searchParams.get('aufgabe'), 'gerade');
  const data = [{ name: 'Anna', punkte: 1200 }];
  context.window[callbackName](data);
  await pending;
  assert.deepEqual(rendered, [{ list: data, name: 'Anna' }]);
  assert.equal(context.highscoreStatus.textContent, '');
  assert.equal(scripts.length, 0);
  assert.equal(Object.keys(context.window).length, 0);
  assert.equal(timers.size, 0);
});

test('blocked or stalled response leaves the loading state after ten seconds', async () => {
  const { context, scripts, timers, rendered } = setupLoader();
  const pending = context.loadHighscores('');
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 10000);
  timer.callback();
  await pending;
  assert.equal(context.highscoreStatus.textContent, 'Bestenliste konnte nicht geladen werden.');
  assert.equal(scripts.length, 0);
  assert.equal(Object.keys(context.window).length, 0);
  assert.equal(timers.size, 0);
  assert.equal(rendered.length, 0);
});

test('network error resolves immediately and prevents a later timeout from changing the result', async () => {
  const { context, scripts, timers } = setupLoader();
  const pending = context.loadHighscores('');
  const lateTimeout = [...timers.values()][0].callback;
  scripts[0].onerror();
  await pending;
  assert.equal(timers.size, 0);
  context.highscoreStatus.textContent = 'New request';
  lateTimeout();
  assert.equal(context.highscoreStatus.textContent, 'New request');
});

