const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');

test('notification remains outside sections hidden during discovery and is announced', () => {
  const template = source.match(/shell\.innerHTML = `([\s\S]*?)`;/)[1];
  const stack = [];
  let found = false;
  for (const match of template.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
    const [, closing, tag, attributes] = match;
    if (closing) { stack.pop(); continue; }
    if (/class="mm-hint"/.test(attributes)) {
      found = true;
      assert.ok(stack.some((parent) => parent.tag === 'aside'));
      assert.ok(stack.every((parent) => !/mm-hero|mm-results|mm-status|mm-controls|mm-body/.test(parent.attributes)));
      assert.match(attributes, /role="status"/);
      assert.match(attributes, /aria-live="polite"/);
    }
    if (!['input', 'img', 'br', 'hr'].includes(tag)) stack.push({ tag, attributes });
  }
  assert.ok(found);
});

test('dislike confirmation appears for four seconds and cannot clear a newer message', () => {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const hint = { textContent: '', hidden: true, classList: { toggle() {} } };
  const context = vm.createContext({
    $: () => hint,
    setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(key) { timers.delete(key); }
  });
  vm.runInContext(source.slice(source.indexOf('  let messageTimer'), source.indexOf('  function options')), context);
  const advance = (ms) => {
    now += ms;
    for (const [key, timer] of timers) if (timer.at <= now) { timers.delete(key); timer.fn(); }
  };
  const messageCall = source.match(/setMessage\(`Disliked[^;]+;/)[0];
  context.track = { title: 'Quiet evening' };
  vm.runInContext(messageCall, context);
  assert.equal(hint.textContent, 'Disliked Quiet evening. Your future picks will adapt.');
  assert.equal(hint.hidden, false);
  advance(3999);
  assert.equal(hint.hidden, false);
  advance(1);
  assert.equal(hint.hidden, true);
  vm.runInContext(messageCall, context);
  advance(2000);
  vm.runInContext('setMessage("Could not load playlist", true)', context);
  advance(2000);
  assert.equal(hint.textContent, 'Could not load playlist');
  assert.equal(hint.hidden, false);
});
