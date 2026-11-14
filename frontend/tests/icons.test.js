'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { names } = require('../shared/icons.js');

const frontendRoot = path.resolve(__dirname, '..');
const materialIconClassPattern = new RegExp(['material', '-symbols'].join(''), 'i');

function runtimeFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...runtimeFiles(file));
    } else if (/\.(html|js)$/i.test(entry.name)) {
      files.push(file);
    }
  }
  return files;
}

function isAdminRuntimeFile(file) {
  return file.includes(`${path.sep}admin${path.sep}`)
    || path.basename(file).startsWith('quan-tri');
}

function referencedIconNames(source) {
  const found = new Set(
    [...source.matchAll(/data-sb-icon\s*=\s*["']([^"']+)["']/g)].map((match) => match[1])
  );
  const calls = /\b(?:setIcon|createIcon|addDetailLine)\s*\(/g;
  for (const match of source.matchAll(calls)) {
    let depth = 1;
    let quote = '';
    let escaped = false;
    let end = match.index + match[0].length;
    for (; end < source.length && depth > 0; end += 1) {
      const character = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
      } else if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
    }
    const argumentsSource = source.slice(match.index + match[0].length, end - 1);
    for (const [, name] of argumentsSource.matchAll(/['"`]([a-z][a-z0-9_]*)['"`]/g)) {
      found.add(name);
    }
  }
  for (const [, name] of source.matchAll(/\bicon\s*:\s*['"`]([a-z][a-z0-9_]*)['"`]/g)) {
    found.add(name);
  }
  return found;
}

test('non-admin frontend markup uses local SVG icons instead of Material ligatures', () => {
  const ligatures = [...names].sort((left, right) => right.length - left.length);
  const ligaturePattern = new RegExp(
    `<[^>]+>\\s*(?:${ligatures.join('|')})\\s*<\\/[^>]+>`,
    'i'
  );
  const requestedLigatures = [
    'sports', 'check', 'schedule', 'location_on', 'arrow_forward', 'arrow_back',
    'cancel', 'receipt', 'event', 'info', 'close', 'delete', 'phone', 'map',
    'directions', 'person'
  ];
  const requestedLigaturePattern = new RegExp(
    `<[^>]+>\\s*(?:${requestedLigatures.join('|')})\\s*<\\/[^>]+>`,
    'i'
  );
  const files = runtimeFiles(frontendRoot).filter((file) =>
    !file.includes(`${path.sep}tests${path.sep}`) && !isAdminRuntimeFile(file)
  );
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, materialIconClassPattern, `${file} contains a Material icon class.`);
    assert.doesNotMatch(source, ligaturePattern, `${file} contains an icon ligature as element text.`);
    assert.doesNotMatch(source, requestedLigaturePattern, `${file} contains a requested icon ligature as text.`);
    for (const [, iconName] of source.matchAll(/data-sb-icon=["']([^"']+)["']/g)) {
      assert.ok(names.has(iconName), `${file} references an unmapped icon: ${iconName}`);
    }
  }
  assert.ok(files.some((file) => file.endsWith(path.join('dat-san-thanh-cong.html'))));
  assert.ok(files.some((file) => file.endsWith(path.join('ve-dien-tu.html'))));
});

test('all frontend HTML and JavaScript icon references are registered', () => {
  const files = runtimeFiles(frontendRoot);
  const missing = new Set();
  for (const file of files) {
    for (const iconName of referencedIconNames(fs.readFileSync(file, 'utf8'))) {
      if (!names.has(iconName)) missing.add(iconName);
    }
  }
  const missingNames = [...missing].sort();
  assert.equal(missingNames.length, 0, `Missing icon names: ${missingNames.join(', ')}`);
});

test('unknown icon names warn and render a neutral SVG instead of throwing', () => {
  const attributes = new Map();
  const pathAttributes = new Map();
  const element = {
    ownerDocument: {
      createElementNS(namespace, tagName) {
        assert.equal(namespace, 'http://www.w3.org/2000/svg');
        assert.equal(tagName, 'path');
        return { setAttribute: (name, value) => pathAttributes.set(name, value) };
      }
    },
    replaceChildren() {},
    setAttribute: (name, value) => attributes.set(name, value),
    append() {}
  };
  const warnings = [];
  const originalWarn = console.warn;
  const unknownName = 'not_' + 'registered';
  try {
    console.warn = (...args) => warnings.push(args);
    assert.doesNotThrow(() => require('../shared/icons.js').setIcon(element, unknownName));
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(attributes.get('stroke'), 'currentColor');
  assert.equal(attributes.get('stroke-width'), '2');
  assert.ok(pathAttributes.get('d'));
  assert.deepEqual(warnings, [['Unknown SportBooking icon: not_registered']]);
});
