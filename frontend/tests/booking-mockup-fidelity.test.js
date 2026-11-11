'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const pages = [
  {
    mockup: path.join(root, 'docs', '02-design', 'mockups', 'lich-su-dat-san.html'),
    output: path.join(root, 'frontend', 'lich-su-dat-san.html')
  },
  {
    mockup: path.join(root, 'docs', '02-design', 'mockups', 'chi-tiet-don-dat-san.html'),
    output: path.join(root, 'frontend', 'chi-tiet-don-dat-san.html')
  }
];

function markupWithoutScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
}

function classNames(html) {
  const classes = new Set();
  for (const match of markupWithoutScripts(html).matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gs)) {
    for (const name of match[2].split(/\s+/).filter(Boolean)) classes.add(name);
  }
  return classes;
}

for (const { mockup, output } of pages) {
  test(`${path.basename(output)} retains all mockup markup classes`, () => {
    const sourceClasses = classNames(fs.readFileSync(mockup, 'utf8'));
    const outputClasses = classNames(fs.readFileSync(output, 'utf8'));
    const intentionallyRemoved = new Set([['material', '-symbols-outlined'].join('')]);
    if (path.basename(output) === 'chi-tiet-don-dat-san.html') {
      intentionallyRemoved.add('text-outline-variant');
    } else {
      intentionallyRemoved.add('self-start');
      intentionallyRemoved.add('md:self-auto');
    }
    const missingClasses = [...sourceClasses]
      .filter((name) => !outputClasses.has(name) && !intentionallyRemoved.has(name));
    assert.deepEqual(missingClasses, []);
  });

  test(`${path.basename(output)} contains no legacy mockup scripts or local storage`, () => {
    const html = fs.readFileSync(output, 'utf8');
    assert.doesNotMatch(html, /localStorage/i);
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]);
    assert.ok(scripts.some((attributes) => /cdn\.tailwindcss\.com/i.test(attributes)));
    assert.ok(scripts.some((attributes) => /id=["']tailwind-config["']/i.test(attributes)));
    assert.ok(scripts.every((attributes) =>
      /(?:cdn\.tailwindcss\.com|id=["']tailwind-config["']|src=["']\/(?:booking|shared)\/[^"']+\.js["'])/i
        .test(attributes)
    ));
    assert.doesNotMatch(html, /firebase|realtime-sync|auth\.js|notification-header/i);
  });
}

test('history detail links use the booking_id query parameter', () => {
  const html = fs.readFileSync(pages[0].output, 'utf8');
  const historyScript = fs.readFileSync(path.join(root, 'frontend', 'booking', 'booking-history-page.js'), 'utf8');
  assert.match(html, /<script src=["']\/shared\/back-nav\.js["']/);
  assert.match(html, /<span>Xem chi tiết<\/span>/);
  assert.match(historyScript, /SportBookingBackNav\.buildDetailUrl\(booking\.booking_id,/);
});

test('detail page replaces the order breadcrumb with dynamic back buttons', () => {
  const html = fs.readFileSync(pages[1].output, 'utf8');
  assert.doesNotMatch(html, /aria-label="Breadcrumb"/);
  assert.equal((html.match(/data-back-button/g) || []).length, 2);
  assert.match(html, /<script src=["']\/shared\/back-nav\.js["']/);
});
