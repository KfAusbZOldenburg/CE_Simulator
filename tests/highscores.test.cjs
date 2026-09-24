const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Function exists: ' + name);
  const end = html.indexOf('\nfunction ', start + 1);
  return html.slice(start, end < 0 ? undefined : end).split('</script>')[0];
}
function createContext() {
  const list = {
    rows: [], textContent: '',
    set innerHTML(value) { this.rows = []; this.textContent = ''; },
    appendChild(row) { this.rows.push(row); }
  };
  const context = vm.createContext({
    highscoreList: list,
    document: { createElement() { return {}; } }
  });
  for (const name of ['getBestHighscores', 'renderHighscores', 'formatHighscoreTime', 'formatTime', 'escapeHtml']) {
    vm.runInContext(extractFunction(name), context);
  }
  return context;
}
const entry = (name, punkte, zeitMs = 30000) => ({ name, punkte, zeitMs });

test('highest score per name, numeric ordering, normalization and original result details', () => {
  const c = createContext();
  const best = entry('ANNA', '1200', 28000);
  const input = [entry(' Anna ', 50), entry('Ben', '900'), best, entry('anna', 500)];
  const original = input.slice();
  const result = c.getBestHighscores(input);
  assert.equal(result.length, 2);
  assert.equal(result[0], best);
  assert.equal(result[1].name, 'Ben');
  assert.deepEqual(input, original);
});

test('ties preserve server order and names remain distinct', () => {
  const c = createContext();
  const first = entry('Anna', 1000);
  const input = [first, entry('ANNA', 1000), entry('Anne', 1000), entry('__proto__', 800)];
  const result = c.getBestHighscores(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], first);
  assert.equal(result[1].name, 'Anne');
});

test('empty and missing lists show the empty message', () => {
  const c = createContext();
  for (const input of [[], null, undefined, {}]) {
    c.renderHighscores(input, '');
    assert.equal(c.highscoreList.textContent, 'Noch keine Einträge vorhanden.');
  }
});

test('deduplication precedes top ten selection and ranking', () => {
  const c = createContext();
  const input = Array.from({ length: 12 }, (_, i) => entry('Player ' + i, 2000 - i));
  input.splice(1, 0, entry('Player 0', 1999), entry('Player 0', 1998));
  c.renderHighscores(input, '');
  assert.equal(c.highscoreList.rows.length, 10);
  assert.match(c.highscoreList.rows[9].innerHTML, /#10<\/span><span>Player 9/);
});

test('own personal best outside top ten keeps its actual unique rank', () => {
  const c = createContext();
  const input = Array.from({ length: 12 }, (_, i) => entry('Player ' + i, 2000 - i));
  input.unshift(entry('PLAYER 11', 20));
  c.renderHighscores(input, ' player 11 ');
  const rows = c.highscoreList.rows;
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(row => row.className.includes('ownScore')).length, 1);
  assert.match(rows[9].innerHTML, /#12<\/span><span>Player 11<\/span><span>1989 P/);
});

test('own top ten entry appears once, time belongs to best run, HTML remains escaped', () => {
  const c = createContext();
  c.renderHighscores([entry('<b>Anna</b>', 100, 60000), entry('<b>Anna</b>', 200, 29000)], '<B>ANNA</B>');
  assert.equal(c.highscoreList.rows.length, 1);
  assert.equal(c.highscoreList.rows[0].className, 'highscoreRow ownScore');
  assert.match(c.highscoreList.rows[0].innerHTML, /&lt;b&gt;Anna&lt;\/b&gt;/);
  assert.match(c.highscoreList.rows[0].innerHTML, /200 P<\/span><span>00:29/);
});

test('all inline simulator scripts remain syntactically valid', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  scripts.forEach((match) => new vm.Script(match[1]));
});
