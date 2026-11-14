'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendRoot = path.resolve(__dirname, '..');
const sharedFontStylesheet = fs.readFileSync(
  path.join(frontendRoot, 'shared', 'header.css'),
  'utf8'
);

function findHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? findHtmlFiles(file)
      : entry.isFile() && entry.name.endsWith('.html') ? [file] : [];
  });
}

function readPage(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

test('shared-header pages load both fonts only through the shared stylesheet', () => {
  const sharedHeaderPages = findHtmlFiles(frontendRoot)
    .map((file) => ({ file, html: fs.readFileSync(file, 'utf8') }))
    .filter(({ html }) => /data-shared-header/.test(html));
  const fontImport = /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/css2\?[^'"]+['"]\);/g;
  const imports = sharedFontStylesheet.match(fontImport) || [];
  const appStylesheet = fs.readFileSync(path.join(frontendRoot, 'app.css'), 'utf8');

  assert.ok(sharedHeaderPages.length > 0);
  assert.equal(imports.length, 1, 'header.css must be the one shared font-loading source');
  assert.doesNotMatch(appStylesheet, /fonts\.googleapis\.com/i);
  assert.match(imports[0], /Be\+Vietnam\+Pro/);
  assert.match(imports[0], /Inter/);
  assert.match(sharedFontStylesheet, /font-family:\s*'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;/);
  assert.match(sharedFontStylesheet, /\.sb-numeric\s*\{\s*font-family:\s*'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;/);

  for (const { file, html } of sharedHeaderPages) {
    assert.match(html, /href=["']\/shared\/header\.css["']/, `${path.relative(frontendRoot, file)} must load the shared header stylesheet`);
    const adminPage = path.basename(file).startsWith('quan-tri');
    const externalFonts = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map(([tag]) => tag)
      .filter((tag) => /\brel=["']stylesheet["']/i.test(tag))
      .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '')
      .filter((href) => /fonts\.(?:googleapis|gstatic)\.com/i.test(href));
    const unexpectedFonts = externalFonts.filter((href) => !(
      adminPage && /fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined/i.test(href)
    ));
    assert.equal(unexpectedFonts.length, 0, `${path.relative(frontendRoot, file)} must use shared font loading`);
  }
});

test('payment and completion pages share the same font loading list', () => {
  const paymentPage = readPage('thanh-toan.html');
  const completionPage = readPage('dat-san-thanh-cong.html');
  const fontLinks = (html) => [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => /fonts\.(?:googleapis|gstatic)\.com/i.test(tag));

  assert.deepEqual(fontLinks(paymentPage), fontLinks(completionPage));
  assert.match(paymentPage, /href=["']\/shared\/header\.css["']/);
  assert.match(completionPage, /href=["']\/shared\/header\.css["']/);
  assert.doesNotMatch(completionPage, /\/booking\/payment\.css/);
});

test('numeric booking codes and amounts use Inter', () => {
  const pages = [
    ['thanh-toan.html', [
      'qrDepositAmount',
      'displayTransferMemo',
      'displaySidebarOrderId',
      'displaySidebarCourtPrice',
      'displaySidebarRemainingPrice',
      'displaySidebarDepositPrice'
    ]],
    ['dat-san-thanh-cong.html', [
      'bookingIdText',
      'ticketTotalAmount',
      'ticketPaidAmount',
      'ticketVenueAmount'
    ]]
  ];

  for (const [relativePath, ids] of pages) {
    const html = readPage(relativePath);
    for (const id of ids) {
      const element = html.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`));
      assert.ok(element, `${id} must exist in ${relativePath}`);
      assert.match(element[0], /\bsb-numeric\b/, `${id} must use Inter`);
    }
  }
});

test('HTML font-family declarations have a sans-serif fallback', () => {
  for (const file of findHtmlFiles(frontendRoot)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      assert.match(match[1], /\bsans-serif\b/i, `${path.relative(frontendRoot, file)} font-family`);
    }
  }
});
