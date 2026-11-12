'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontend = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(frontend, 'notifications', 'notifications-page.js'), 'utf8');
const pageCss = fs.readFileSync(path.join(frontend, 'notifications', 'notifications.css'), 'utf8');
const header = fs.readFileSync(path.join(frontend, 'shared', 'header.js'), 'utf8');
const headerCss = fs.readFileSync(path.join(frontend, 'shared', 'header.css'), 'utf8');
const html = fs.readFileSync(path.join(frontend, 'thong-bao.html'), 'utf8');

test('notification card markup uses three regions with its action below the timestamp in region three', () => {
  assert.match(page, /article\.append\(iconBox,\s*content,\s*actions\)/);
  assert.match(page, /actions\.append\(meta\)[\s\S]*?actions\.append\(link\)/);
  assert.match(pageCss, /grid-template-columns:\s*52px\s+minmax\(0,\s*1fr\)\s+150px/);
  assert.match(pageCss, /notification-card__actions\s*\{[^}]*width:\s*150px/s);
  assert.match(pageCss, /@media \(max-width: 640px\)[\s\S]*?notification-card__actions\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(pageCss, /\.notification-card__link\s*\{[^}]*width:\s*100%/s);
});

test('unread cards show a small status dot and read cards do not show a read label', () => {
  const card = page.slice(page.indexOf('function createNotificationCardFrame'), page.indexOf('function createNotificationDetails'));
  assert.match(card, /if \(!notification\.read_at\)[\s\S]*?notification-card__unread-dot/);
  assert.match(card, /createTextNode\('Chưa đọc'\)/);
  assert.doesNotMatch(card, /Đánh dấu đã đọc|Đã đọc/);
  assert.match(pageCss, /\.notification-card__unread-dot\s*\{[^}]*border-radius:\s*50%/s);
  assert.match(pageCss, /\.notification-card\.is-unread\s*\{[^}]*border-left-width:\s*5px/s);
  assert.match(pageCss, /\.notification-card__link[\s\S]*?notification-card__actions/);
});

test('notification page and bell use the same style and facility-label helpers', () => {
  assert.match(page, /stateTools\.getNotificationStyle\(notification\)/);
  assert.match(page, /stateTools\.dedupeFacilityLabel\(notification\.body\)/);
  assert.match(header, /SportBookingNotificationState\.getNotificationStyle\(item\)/);
  assert.match(header, /SportBookingNotificationState\.dedupeFacilityLabel\(item\.body\)/);
  assert.doesNotMatch(header, /function notificationPresentation/);
  assert.match(header, /script\.src = '\/notifications\/notifications-state\.js'/);
});

test('notification cards and bell rows do not prepend type labels to titles', () => {
  assert.doesNotMatch(page, /notification-card__type|label\.textContent = style\.label/);
  assert.doesNotMatch(header, /sb-shared-header__notification-type|style\.label\)/);
  assert.doesNotMatch(pageCss, /\.notification-card__type/);
  assert.doesNotMatch(headerCss, /\.sb-shared-header__notification-type/);
});

test('read state updates locally and notifies the bell to refresh its unread count', () => {
  assert.match(page, /method:\s*'PATCH'/);
  assert.match(page, /renderItems\(state\.notifications\);\s*dispatchStateChanged\(\{ id:/);
  assert.match(page, /data-category-unread/);
  assert.match(header, /addEventListener\('notification-state-changed'/);
  assert.match(html, /data-notifications-unread-count/);
  assert.match(html, /data-category-unread="BOOKING_HOLD"/);
  assert.match(html, /data-category-unread="PAYMENT"/);
});

test('notification markup and scripts do not use Google icon ligature fonts', () => {
  const sources = `${html}\n${page}\n${header}\n${pageCss}\n${headerCss}`;
  assert.doesNotMatch(sources, /material-icons|material-symbols|font material/i);
});
