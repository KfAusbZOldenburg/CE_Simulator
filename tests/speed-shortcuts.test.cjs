const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function setup() {
  const context = vm.createContext({
    maxSpeed: 4, gameRunning: true,
    controls: { style: { display: 'flex' } },
    speedSlider: { min: '1', max: '10', value: '4', tagName: 'INPUT' },
    speedDisplay: {}, document: { activeElement: null }
  });
  for (const name of ['clamp', 'setMaxSpeed', 'handleSpeedShortcut']) {
    const start = html.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    const end = html.indexOf('\n}', start) + 2;
    vm.runInContext(html.slice(start, end), context);
  }
  return context;
}
function press(c, key, options = {}) {
  const event = { key, prevented: false, preventDefault() { this.prevented = true; }, ...options };
  const handled = c.handleSpeedShortcut(event);
  return { handled, prevented: event.prevented };
}

test('plus and minus, including numpad keys, update value, slider and label together', () => {
  const c = setup();
  assert.equal(press(c, '+').handled, true);
  assert.equal(c.maxSpeed, 5);
  assert.equal(c.speedSlider.value, '5');
  assert.equal(c.speedDisplay.textContent, 'Max. Geschwindigkeit: 5');
  press(c, '+', { code: 'NumpadAdd' });
  assert.equal(c.maxSpeed, 6);
  press(c, '-', { code: 'NumpadSubtract' });
  assert.equal(c.maxSpeed, 5);
  press(c, '-');
  assert.equal(c.maxSpeed, 4);
});

test('limits stay at 1 and 10; manual slider setting remains the shortcut starting point', () => {
  const c = setup();
  c.setMaxSpeed(10); press(c, '+');
  assert.equal(c.maxSpeed, 10);
  c.setMaxSpeed(1); press(c, '-');
  assert.equal(c.maxSpeed, 1);
  c.setMaxSpeed(7); press(c, '+');
  assert.equal(c.maxSpeed, 8);
});

test('holding a key does not cause extra steps', () => {
  const c = setup();
  press(c, '+');
  assert.deepEqual(press(c, '+', { repeat: true }), { handled: true, prevented: true });
  assert.equal(c.maxSpeed, 5);
});

test('browser shortcuts, composition and unrelated keys remain untouched', () => {
  const c = setup();
  for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) {
    assert.deepEqual(press(c, '+', { [flag]: true }), { handled: false, prevented: false });
    assert.deepEqual(press(c, '-', { [flag]: true }), { handled: false, prevented: false });
  }
  assert.equal(press(c, 'w').handled, false);
  assert.equal(c.maxSpeed, 4);
});

test('text entry and menus do not change speed; focused speed slider does', () => {
  const c = setup();
  for (const element of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true }]) {
    c.document.activeElement = element;
    assert.deepEqual(press(c, '+'), { handled: false, prevented: false });
  }
  c.document.activeElement = null;
  c.gameRunning = false;
  assert.equal(press(c, '+').handled, false);
  c.gameRunning = true;
  c.controls.style.display = 'none';
  assert.equal(press(c, '+').handled, false);
  assert.equal(c.maxSpeed, 4);
  c.controls.style.display = 'flex';
  c.document.activeElement = c.speedSlider;
  press(c, '+');
  assert.equal(c.maxSpeed, 5);
});
