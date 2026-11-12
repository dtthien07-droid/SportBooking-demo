'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  formatCountdown,
  getBookingStatusLabel,
  getBookingErrorAction,
  getBookingErrorView,
  getBookingPresentation,
  getBookingSummaryPresentation,
  canCancelBooking,
  getCancellationSuccessMessage
} = require('../booking/booking-history-state.js');

const root = path.resolve(__dirname, '..', '..');
const historyHtml = fs.readFileSync(path.join(root, 'frontend', 'lich-su-dat-san.html'), 'utf8');
const historyPage = fs.readFileSync(path.join(root, 'frontend', 'booking', 'booking-history-page.js'), 'utf8');
const historyCss = fs.readFileSync(path.join(root, 'frontend', 'booking', 'booking.css'), 'utf8');
const historyMockup = fs.readFileSync(
  path.join(root, 'docs', '02-design', 'mockups', 'lich-su-dat-san.html'),
  'utf8'
);
const legacyMaterialIconClass = ['material', '-symbols-outlined'].join('');

function classNames(source) {
  const classes = new Set();
  for (const match of source.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gs)) {
    for (const [, expression] of match[2].matchAll(/\$\{([^}]*)\}/g)) {
      for (const [, dynamicClasses] of expression.matchAll(/['"]([^'"]+)['"]/g)) {
        for (const name of dynamicClasses.split(/\s+/).filter(Boolean)) classes.add(name);
      }
    }
    const classValue = match[2].replace(/\$\{[^}]*\}/g, ' ');
    for (const name of classValue.split(/\s+/).filter(Boolean)) classes.add(name);
  }
  return classes;
}

function removeTemplateExpressions(source) {
  let result = '';
  for (let index = 0; index < source.length;) {
    if (source[index] !== '$' || source[index + 1] !== '{') {
      result += source[index++];
      continue;
    }

    let depth = 1;
    let quote = null;
    let escaped = false;
    index += 2;
    while (index < source.length && depth > 0) {
      const character = source[index++];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
      } else if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === '{') {
        depth++;
      } else if (character === '}') {
        depth--;
      }
    }
    assert.equal(depth, 0, 'Biểu thức trong thẻ mockup chưa đóng');
  }
  return result;
}

function parseElements(markup) {
  const rootNode = { tag: '#root', classes: [], attributes: {}, children: [] };
  const stack = [rootNode];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi)) {
    const tagMatch = /^<\s*(\/?)\s*([a-z][\w:-]*)\b([^>]*)>/i.exec(token[0]);
    if (!tagMatch) continue;
    const [, closing, tag, rawAttributes] = tagMatch;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attributes = {};
    for (const match of rawAttributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    const node = {
      tag: tag.toLowerCase(),
      classes: (attributes.class || '').split(/\s+/).filter(Boolean),
      attributes,
      children: []
    };
    stack[stack.length - 1].children.push(node);
    if (!voidTags.has(node.tag) && !/\/\s*>$/.test(token[0])) stack.push(node);
  }
  return rootNode.children;
}

function comparableMockupTree(tree) {
  const ignoredDynamicClasses = new Set([
    'text-primary', 'text-secondary', 'text-gray-600', 'text-gray-500',
    'text-gray-400', 'text-on-surface', 'hover:text-primary', 'line-through',
    'grayscale', 'opacity-80', 'bg-secondary-fixed', 'bg-emerald-100',
    'text-emerald-800', 'text-on-surface-variant', 'text-on-secondary-fixed-variant',
    'bg-orange-100', 'animate-pulse', 'bg-red-50', 'text-red-600', 'bg-blue-50',
    'text-tertiary'
  ]);
  function normalize(node) {
    if ('data-booking-actions' in node.attributes) return null;
    const isIcon = 'data-sb-icon' in node.attributes || node.classes.includes(legacyMaterialIconClass);
    return {
      tag: isIcon ? '#icon' : node.tag,
      classes: node.classes.filter((name) =>
        name !== legacyMaterialIconClass && !ignoredDynamicClasses.has(name)),
      children: isIcon ? [] : node.children.map(normalize).filter(Boolean)
    };
  }
  return tree.map(normalize).filter(Boolean);
}

function flattenedClasses(node) {
  return node.classes.concat(...node.children.map(flattenedClasses));
}

function findTreeNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findTreeNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function treeDifference(expected, actual, pathName = 'article') {
  if (!expected || !actual) {
    return `${pathName}: ${expected ? 'thiếu phần tử ở output' : 'thừa phần tử ở output'} (${JSON.stringify(actual || expected)})`;
  }
  if (expected.tag !== actual.tag) {
    return `${pathName}: mong <${expected.tag}>, nhận <${actual.tag}>`;
  }
  if (JSON.stringify(expected.classes) !== JSON.stringify(actual.classes)) {
    return `${pathName} <${actual.tag}>: class mong [${expected.classes.join(' ')}], nhận [${actual.classes.join(' ')}]`;
  }
  const count = Math.max(expected.children.length, actual.children.length);
  for (let index = 0; index < count; index++) {
    const difference = treeDifference(expected.children[index], actual.children[index], `${pathName}/${actual.tag}[${index + 1}]`);
    if (difference) return difference;
  }
  return null;
}

function runtimeCardClassNames() {
  const start = historyPage.indexOf('function createBookingCard(');
  const end = historyPage.indexOf('function renderPagination(', start);
  const cardCode = historyPage.slice(start, end);
  const classes = new Set();
  for (const match of cardCode.matchAll(/classList\.(?:add|remove|toggle|replace)\(([^)]*)\)/gs)) {
    for (const [, value] of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      if (!['CANCELLED', 'UPCOMING', 'IN_PROGRESS', 'PENDING'].includes(value)) classes.add(value);
    }
  }
  const statusFunction = /function statusClasses\(code\) \{([\s\S]*?)\n  \}/.exec(historyPage)?.[1] || '';
  for (const [, value] of statusFunction.matchAll(/return '([^']+)'/g)) {
    for (const name of value.split(/\s+/)) classes.add(name);
  }
  return classes;
}

function booking(status, displayStatusCode, extra = {}) {
  return {
    booking_id: '42',
    status,
    display_status_code: displayStatusCode,
    display_status: 'Trạng thái',
    remaining_seconds: 90,
    slots: [{ facility_id: '7' }],
    ...extra
  };
}

function renderedCardSnapshot(card) {
  const field = (selector) => card.querySelector(selector).textContent;
  return JSON.stringify({
    bookingId: card.dataset.bookingId,
    status: card.dataset.status,
    bookingCode: field('[data-booking-code]'),
    courtName: field('[data-court-name]'),
    facilityName: field('[data-facility-name]'),
    address: field('[data-facility-address]'),
    date: field('[data-date]'),
    time: field('[data-time-range]'),
    statusLabel: card.querySelector('[data-status-badge]')
      .querySelector('[data-status-label]').textContent,
    paidAmount: field('[data-paid-amount]'),
    paidLabel: field('[data-paid-label]'),
    primaryHidden: card.querySelector('[data-primary-action]').hidden,
  });
}

function createHistoryPageRuntime(record, facilityImageUrl = null) {
  const templateMarkup = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  const templateArticle = /<article\b[\s\S]*?<\/article>/.exec(templateMarkup || '')?.[0];
  const templateTree = parseElements(templateArticle || '')[0];

  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.listeners = {};
      this.classNames = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => this.classNames.add(name)),
        remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
        toggle: (name, force) => {
          const enabled = force === undefined ? !this.classNames.has(name) : force;
          if (enabled) this.classNames.add(name);
          else this.classNames.delete(name);
          return enabled;
        },
        replace: (oldName, newName) => {
          this.classNames.delete(oldName);
          this.classNames.add(newName);
        }
      };
      this.nodes = new Map();
    }

    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = value;
    }

    append(...children) {
      this.children.push(...children);
    }

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }

    querySelector(selector) {
      if (!this.nodes.has(selector)) this.nodes.set(selector, new FakeNode());
      return this.nodes.get(selector);
    }

    querySelectorAll(selector) {
      if (selector === '[data-detail-link], [data-detail-image-link]') {
        return [
          this.querySelector('[data-detail-link]'),
          this.querySelector('[data-detail-image-link]')
        ];
      }
      return [];
    }

    replaceChildren(...children) {
      this.children = children;
      for (const child of children) child.parentNode = this;
    }

    replaceWith(replacement) {
      this.replacedWith = replacement;
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1, replacement);
      replacement.parentNode = this.parentNode;
    }
  }

  const list = new FakeNode();
  const assignedUrls = [];
  const cancellationOpenIds = [];
  const apiCalls = [];
  let summaryCalls = 0;
  let onCancelled;
  let card;
  const template = {
    content: {
      firstElementChild: {
        cloneNode: () => {
          card = new FakeNode();
          card.elementTree = JSON.parse(JSON.stringify(templateTree));
          card.querySelector('[data-booking-image]').alt = '';
          card.querySelector('[data-primary-action]').hidden = true;
          return card;
        }
      }
    }
  };
  const ids = [
    'history-loading', 'history-error', 'history-error-message', 'history-retry',
    'history-empty', 'history-empty-title', 'history-empty-description',
    'history-pagination', 'pagination-info', 'current-page', 'previous-page',
    'next-page', 'search-input', 'sport-filter', 'stat-upcoming-count',
    'stat-completed-count', 'stat-total-spent', 'cancel-result-message',
    'count-all', 'count-upcoming', 'count-payment-pending', 'count-completed',
    'count-cancelled', 'count-expired'
  ];
  const elements = new Map(ids.map((id) => [id, new FakeNode()]));
  elements.set('bookings-list', list);
  elements.set('booking-card-template', template);
  const facilityAddress = 'Đường Nguyễn Văn A, phường B, quận C, thành phố D '.repeat(5);
  const window = {
    location: {
      pathname: '/lich-su-dat-san.html',
      search: '',
      hash: '',
      assign(url) { assignedUrls.push(url); }
    },
    history: { replaceState() {} },
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener() {},
    SportBookingHistoryState: require('../booking/booking-history-state.js'),
    SportBookingApi: {
      async listBookings() {
        apiCalls.push('listBookings');
        return {
          bookings: [record],
          pagination: { page: 1, total_pages: 1, total: 1 }
        };
      },
      async getBookingSummary() {
        apiCalls.push('getBookingSummary');
        summaryCalls++;
        return {
          upcoming_count: 1,
          completed_count: 0,
          total_spent: '120000',
          counts_by_status: {
            'Chờ thanh toán': 1,
            'Sắp tới/Đang trong trận': 1,
            'Hoàn thành': 0,
            'Đã hủy': summaryCalls > 1 ? 1 : 0,
            'Hết hạn': 0
          }
        };
      },
      async getFacility() {
        apiCalls.push('getFacility');
        return {
          facility: {
            name: 'Sân mẫu',
            address: facilityAddress,
            image_url: facilityImageUrl
          }
        };
      },
      async getBooking(id) {
        apiCalls.push(`getBooking:${id}`);
        return {
          ...record,
          status: 'CANCELLED',
          display_status_code: 'CANCELLED',
          display_status: 'Đã hủy',
          payment: {
            paid_amount: '120000',
            refunded_amount: '50000'
          }
        };
      }
    },
    SportBookingCancellationDialog: {
      initialize: ({ onCancelled: callback }) => {
        onCancelled = callback;
        return { open(id) { cancellationOpenIds.push(id); } };
      }
    },
    SportBookingBackNav: { buildDetailUrl: () => '/chi-tiet-don-dat-san.html?booking_id=42' },
    SportBookingIcons: { setIcon(node, icon) { node.icon = icon; } }
  };
  const document = {
    querySelectorAll: () => [],
    getElementById: (id) => elements.get(id),
    createElement: (tagName) => new FakeNode(tagName)
  };
  vm.runInNewContext(historyPage, { window, document, URLSearchParams });

  return new Promise((resolve) => {
    setImmediate(() => resolve({
      card,
      facilityAddress,
      image: card.querySelector('[data-booking-image]'),
      imageFrame: card.querySelector('[data-detail-image-link]'),
      assignedUrls,
      cancellationOpenIds,
      list,
      elements,
      apiCalls,
      onCancelled
    }));
  });
}

test('thẻ lịch sử chỉ có một vị trí hiển thị tên cơ sở', () => {
  const template = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  assert.ok(template, 'Thiếu template thẻ lịch sử');
  assert.equal((template.match(/data-facility-name/g) || []).length, 1);
  assert.match(historyPage, /querySelector\('\[data-facility-name\]'\)\.textContent = facilityName/);
  assert.match(historyPage, /courtName\.trim\(\)\.toLowerCase\(\) !== facilityName\.trim\(\)\.toLowerCase\(\)/);
  assert.match(historyPage, /querySelector\('\[data-court-name\]'\)\.hidden = !showCourtName/);
});

test('thẻ luôn giữ ảnh và chọn ảnh mặc định tương ứng với môn thể thao', () => {
  const template = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  assert.ok(template, 'Thiếu template thẻ lịch sử');
  const imageFrameClasses = /data-detail-image-link class="([^"]*)"/.exec(template)?.[1].split(/\s+/);
  assert.ok(imageFrameClasses, 'Thiếu khung ảnh');
  for (const className of ['lg:w-72', 'xl:w-80', 'min-h-[190px]', 'shrink-0']) {
    assert.ok(imageFrameClasses.includes(className), `Thiếu class cố định cho ảnh: ${className}`);
  }
  assert.match(template, /<img data-booking-image data-field="image" class="w-full h-full object-cover min-h-\[190px\]" alt=""/);
  assert.doesNotMatch(historyPage, /image\.remove\(\)/);
  for (const sport of ['football-mini', 'badminton', 'pickleball']) {
    assert.ok(fs.existsSync(path.join(root, 'frontend', 'assets', 'images', `court-default-${sport}.svg`)));
    assert.ok(historyPage.includes(`/assets/images/court-default-${sport}.svg`));
  }
  assert.match(historyPage, /fallbackColor: '#006b2c'/);
  assert.match(historyPage, /fallbackColor: '#9d4300'/);
  assert.match(historyPage, /fallbackColor: '#0051d5'/);
  assert.match(historyPage, /imageFrame\.style\.backgroundColor = sport\.fallbackColor/);
  assert.match(historyPage, /image\.src = facility\?\.image_url \|\| sport\.defaultImage/);
  assert.match(template, /data-booking-image[^>]*alt=""/);
  assert.match(historyPage, /image\.onerror = \(\) => \{[\s\S]*?image\.src = sport\.defaultImage;[\s\S]*?image\.hidden = true/);
});

test('cây phần tử của thẻ ở bốn trạng thái khớp mockup, sai khác báo đường dẫn', async () => {
  const template = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  assert.ok(template, 'Thiếu template thẻ lịch sử');
  const mockupSource = /<article class="booking-card[\s\S]*?<\/article>/.exec(historyMockup)?.[0];
  const mockupArticle = mockupSource && removeTemplateExpressions(mockupSource);
  const templateArticle = /<article\b[\s\S]*?<\/article>/.exec(template)?.[0];
  assert.ok(mockupArticle, 'Không tìm thấy thẻ mẫu trong mockup');
  assert.ok(templateArticle, 'Không tìm thấy article trong template');
  const expected = comparableMockupTree(parseElements(mockupArticle));
  const badgeMarkup = [...historyMockup.matchAll(/badgeHtml:\s*`([\s\S]*?)`/g)]
    .find(([, markup]) => markup.includes('timer'))?.[1];
  const priceStart = historyMockup.indexOf('let priceHtml =');
  const priceMarkup = [...historyMockup.slice(priceStart).matchAll(/priceHtml = `([\s\S]*?)`;/g)][0]?.[1];
  assert.ok(badgeMarkup, 'Không tìm thấy badge trạng thái mẫu trong mockup');
  assert.ok(priceMarkup, 'Không tìm thấy khối giá mẫu trong mockup');
  const mockupBadge = comparableMockupTree(parseElements(removeTemplateExpressions(badgeMarkup)))[0];
  const mockupPrice = comparableMockupTree(parseElements(removeTemplateExpressions(priceMarkup)))[0];
  const statusRow = findTreeNode(expected[0], (node) =>
    node.tag === 'div' && node.classes.includes('flex-wrap') && node.classes.includes('justify-between'));
  const footer = findTreeNode(expected[0], (node) =>
    node.tag === 'div' && node.classes.includes('border-t'));
  assert.ok(statusRow, 'Không tìm thấy hàng trạng thái trong cây mockup');
  assert.ok(footer, 'Không tìm thấy footer trong cây mockup');
  statusRow.children.push(mockupBadge);
  footer.children.unshift(mockupPrice);
  const cardTree = parseElements(templateArticle)[0];
  const statuses = [
    ['PENDING', 'PENDING'],
    ['CONFIRMED', 'UPCOMING'],
    ['CANCELLED', 'CANCELLED'],
    ['PENDING', 'EXPIRED']
  ];
  for (const [status, displayStatus] of statuses) {
    const runtime = await createHistoryPageRuntime({
      ...booking(status, displayStatus),
      booking_code: `SPB-${status}`,
      paid_amount: '120000',
      slots: [{
        facility_id: '7',
        facility_name: 'Sân mẫu',
        court_name: 'Sân 1',
        sport_type: 'BADMINTON',
        service_date: '2026-11-12',
        starts_at: '10:00:00',
        ends_at: '11:00:00'
      }]
    });
    assert.equal(runtime.list.children.length, 1, `${status}: không dựng được thẻ`);
    const output = comparableMockupTree([runtime.card.elementTree]);
    const difference = treeDifference(expected[0], output[0]);
    assert.equal(difference, null, `${status}: ${difference}`);
  }
  assert.equal((template.match(/data-booking-image/g) || []).length, 1, 'Ảnh thẻ chỉ được xuất hiện một lần');
  assert.doesNotMatch(template, /data-cancelled-note|data-review-action|Điều 5|Đánh giá/);
  assert.match(template, /data-cancel-action[^>]*hidden/);

  const actionMarkup = [...templateArticle.matchAll(/<(button)\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, , attributes]) => /data-(?:primary-action|detail-link)/.test(attributes));
  assert.equal(actionMarkup.length, 2, 'Thẻ có đúng hai nút hành động');
  const actions = actionMarkup.map(([, tag, attributes]) => [
    tag,
    /class="([^"]*)"/.exec(attributes)?.[1]
  ]);
  const mockupDetailButton = [...historyMockup.matchAll(/<button\b([^>]*)>[\s\S]*?<\/button>/g)]
    .find(([button]) => button.includes('<span>Xem chi tiết</span>'));
  const mockupDetailClasses = /class="([^"]*)"/.exec(mockupDetailButton?.[1] || '')?.[1];
  assert.ok(mockupDetailClasses, 'Không tìm thấy nút chi tiết trong mockup');
  assert.deepEqual(
    actions,
    [
      ['button', mockupDetailClasses],
      ['button', mockupDetailClasses]
    ]
  );
  const actionTrees = actionMarkup.map(([markup]) => parseElements(markup)[0]);
  const mockupActionTree = parseElements(mockupDetailButton[0])[0];
  const actionShape = (node) => ({
    tag: 'data-sb-icon' in node.attributes || node.classes.includes(legacyMaterialIconClass)
      ? '#icon'
      : node.tag,
    classes: node.classes.filter((name) => name !== legacyMaterialIconClass),
    children: 'data-sb-icon' in node.attributes || node.classes.includes(legacyMaterialIconClass)
      ? []
      : node.children.map(actionShape)
  });
  for (const [index, actionTree] of actionTrees.entries()) {
    const difference = treeDifference(
      actionShape(mockupActionTree),
      actionShape(actionTree),
      `article/div[data-booking-actions]/button[${index + 1}]`
    );
    assert.equal(difference, null, difference);
  }
  const actionClasses = actionMarkup.flatMap(([, , attributes]) =>
    /class="([^"]*)"/.exec(attributes)?.[1].split(/\s+/) || []);
  assert.equal(actionClasses.some((name) =>
    ['flex-1', 'grow', 'h-full', 'w-full', 'self-stretch'].includes(name)
  ), false, 'Nút hành động không được kéo giãn');
  assert.equal(flattenedClasses(cardTree).some((name) =>
    ['w-64', 'ml-64', 'pl-64', 'basis-64'].includes(name)
  ), false, 'Thẻ không được chứa class tạo khoảng lệch 256px');
  assert.equal(flattenedClasses(cardTree).some((name) =>
    ['flex-1', 'grow', 'h-full', 'w-full', 'self-stretch'].includes(name)
    && actionClasses.includes(name)
  ), false, 'Nút hành động không được chứa class kéo giãn');
});

test('thẻ CANCELLED giữ cấu trúc, không có lời nhắn trong thẻ hay nút Hủy', async () => {
  const runtime = await createHistoryPageRuntime({
    ...booking('CANCELLED', 'CANCELLED'),
    booking_code: 'SPB-20261111-000042',
    paid_amount: '120000',
    refunded_amount: '50000',
    slots: [{
      facility_id: '7',
      facility_name: 'Sân mẫu',
      court_name: 'Sân 1',
      sport_type: 'BADMINTON',
      service_date: '2026-11-12',
      starts_at: '10:00:00',
      ends_at: '11:00:00'
    }]
  });
  const template = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  assert.ok(template);
  assert.equal((template.match(/<article\b/g) || []).length, 1);
  assert.doesNotMatch(template, /data-cancelled-note|Đã hủy đơn thành công|Điều 5/);
  assert.match(template, /data-cancel-action[^>]*hidden/);
  assert.equal(runtime.card.querySelector('[data-cancel-action]').hidden, true);
  assert.equal(runtime.card.dataset.status, 'CANCELLED');
  assert.equal(runtime.card.dataset.bookingId, '42');
  assert.equal(
    runtime.card.querySelector('[data-status-badge]').querySelector('[data-status-label]').textContent,
    'Đã hủy'
  );
  assert.equal(runtime.card.querySelector('[data-primary-action]').hidden, true);
  assert.equal(runtime.card.querySelector('[data-paid-label]').textContent, 'Đã hoàn:');
  assert.equal(runtime.card.querySelector('[data-paid-amount]').textContent, '50.000 đ');
});

test('hủy thành công thay riêng thẻ bằng cùng renderer, cập nhật summary và thông báo nằm ngoài thẻ', async () => {
  const original = {
    ...booking('CONFIRMED', 'UPCOMING'),
    booking_code: 'SPB-20261111-000042',
    paid_amount: '120000',
    slots: [{
      facility_id: '7',
      facility_name: 'Sân mẫu',
      court_name: 'Sân 1',
      sport_type: 'BADMINTON',
      service_date: '2026-11-12',
      starts_at: '10:00:00',
      ends_at: '11:00:00'
    }]
  };
  const runtime = await createHistoryPageRuntime(original);
  const oldCard = runtime.card;
  const result = { booking_id: '42', status: 'CANCELLED', refunded_amount: '50000' };
  await runtime.onCancelled(result, '', {
    bookingId: '42',
    bookingCode: original.booking_code,
    bookingStatus: 'CONFIRMED'
  });

  const replacement = runtime.list.children[0];
  assert.notEqual(replacement, oldCard);
  assert.equal(oldCard.replacedWith, replacement);
  assert.equal(replacement.dataset.status, 'CANCELLED');
  assert.equal(replacement.querySelector('[data-paid-label]').textContent, 'Đã hoàn:');
  assert.equal(replacement.querySelector('[data-paid-amount]').textContent, '50.000 đ');
  const expectedRuntime = await createHistoryPageRuntime({
    ...original,
    status: 'CANCELLED',
    display_status_code: 'CANCELLED',
    refunded_amount: '50000'
  });
  assert.equal(
    renderedCardSnapshot(replacement),
    renderedCardSnapshot(expectedRuntime.card),
    'Thẻ sau hủy phải khớp kết quả renderer với cùng dữ liệu đã hủy'
  );
  assert.match(historyPage, /const replacement = createBookingCard\(refreshedBooking, facilityData\);[\s\S]*?oldCard\.replaceWith\(replacement\)/);
  assert.deepEqual(runtime.apiCalls.filter((call) =>
    call === 'getBooking:42' || call === 'getBookingSummary'
  ).sort(), ['getBooking:42', 'getBookingSummary', 'getBookingSummary']);
  assert.equal(runtime.elements.get('count-cancelled').textContent, '(1)');
  const toast = runtime.elements.get('cancel-result-message').replacedWith;
  assert.equal(toast.attributes.role, 'status');
  assert.equal(toast.hidden, false);
  assert.equal(toast.querySelector('[data-cancel-result-message]').textContent,
    'Đã hủy đơn SPB-20261111-000042. Hoàn 50.000 đ về phương thức thanh toán.');
  assert.notEqual(toast, replacement);
});

test('nội dung thông báo hủy theo trạng thái và số tiền server trả về', () => {
  assert.equal(
    getCancellationSuccessMessage('SPB-1', '250000', 'CONFIRMED'),
    'Đã hủy đơn SPB-1. Hoàn 250.000 đ về phương thức thanh toán.'
  );
  assert.equal(
    getCancellationSuccessMessage('SPB-2', '0', 'CONFIRMED'),
    'Đã hủy đơn SPB-2. Không có khoản hoàn theo chính sách hủy.'
  );
  assert.equal(
    getCancellationSuccessMessage('SPB-3', null, 'PENDING'),
    'Đã hủy đơn SPB-3.'
  );
  assert.doesNotMatch([
    getCancellationSuccessMessage('SPB-1', '250000', 'CONFIRMED'),
    getCancellationSuccessMessage('SPB-2', '0', 'CONFIRMED'),
    getCancellationSuccessMessage('SPB-3', null, 'PENDING')
  ].join(' '), /Điều 5/);
});

test('CSS thẻ khóa kích thước ảnh, giới hạn địa chỉ và không kéo giãn nhóm nút', () => {
  assert.match(historyHtml, /href="\/booking\/booking\.css"/);
  assert.match(historyCss, /data-detail-image-link\]\s*\{[^}]*height:\s*190px;[^}]*overflow:\s*hidden;/s);
  assert.match(historyCss, /data-booking-image\]\s*\{[^}]*height:\s*100%;[^}]*object-fit:\s*cover;/s);
  assert.match(historyCss, /data-facility-address\]\s*\{[^}]*-webkit-line-clamp:\s*2;/s);
  assert.match(historyCss, /data-booking-actions\]\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(historyCss, /data-booking-actions\]\s*\{[^}]*width:\s*fit-content;/s);
  assert.match(historyCss, /data-booking-actions\]\s*>\s*\*\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(historyCss, /data-booking-content\]\s*\{[^}]*min-width:\s*0;/s);
  assert.match(historyCss, /data-booking-footer\]\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.doesNotMatch(historyCss, /data-booking-info\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*max-content\)/s);
  assert.match(historyCss, /data-primary-action\][\s\S]*?width:\s*fit-content;[\s\S]*?flex:\s*0 0 auto;/);
  assert.doesNotMatch(historyHtml, /data-booking-actions class="[^"]*\bw-full\b/);
  assert.match(historyCss, /@media \(min-width: 1024px\)[\s\S]*?flex-basis:\s*18rem;[\s\S]*?width:\s*18rem;/);
  assert.match(historyCss, /@media \(min-width: 1280px\)[\s\S]*?flex-basis:\s*20rem;[\s\S]*?width:\s*20rem;/);
});

test('dựng thẻ offline cho PENDING, CONFIRMED, CANCELLED và EXPIRED có ảnh, địa chỉ và nút phù hợp', async () => {
  const cases = [
    { status: 'PENDING', displayStatus: 'PENDING', primaryHidden: false },
    { status: 'CONFIRMED', displayStatus: 'UPCOMING', primaryHidden: false },
    { status: 'CANCELLED', displayStatus: 'CANCELLED', primaryHidden: true },
    { status: 'PENDING', displayStatus: 'EXPIRED', primaryHidden: true }
  ];

  for (const [index, item] of cases.entries()) {
    const record = {
      booking_id: '42',
      booking_code: `SPB-20261111-00000${index}`,
      status: item.status,
      display_status_code: item.displayStatus,
      remaining_seconds: 90,
      paid_amount: '120000',
      slots: [{
        facility_id: '7',
        facility_name: 'Sân mẫu',
        court_name: 'Sân 1',
        sport_type: 'BADMINTON',
        service_date: '2026-11-12',
        starts_at: '10:00:00',
        ends_at: '11:00:00'
      }]
    };
    const imageUrl = item.displayStatus === 'UPCOMING' ? '/broken-court-image.jpg' : null;
    const runtime = await createHistoryPageRuntime(record, imageUrl);
    const {
      card, facilityAddress, image, imageFrame, assignedUrls, cancellationOpenIds, list
    } = runtime;

    assert.equal(list.children.length, 1);
    assert.equal(card.querySelector('[data-facility-name]').textContent, 'Sân mẫu');
    assert.equal(card.querySelector('[data-facility-address]').title, facilityAddress);
    assert.equal(card.querySelector('[data-status-badge]').querySelector('[data-status-label]').textContent.length > 0, true);
    assert.equal(card.querySelector('[data-primary-action]').hidden, item.primaryHidden);
    card.querySelector('[data-detail-link]').listeners.click();
    assert.deepEqual(assignedUrls, ['/chi-tiet-don-dat-san.html?booking_id=42']);
    assert.equal(
      card.querySelector('[data-cancel-action]').hidden,
      !canCancelBooking(record)
    );
    assert.equal(image.alt, 'Sân mẫu');
    if (imageUrl) {
      assert.equal(image.src, imageUrl);
      image.onerror();
    }
    assert.equal(image.src, '/assets/images/court-default-badminton.svg');
    image.onerror();
    assert.equal(image.hidden, true);
    assert.equal(imageFrame.style.backgroundColor, '#9d4300');
  }
});

test('thông tin thẻ và các nút theo sát cấu trúc hàng ngang của mockup', () => {
  const template = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  assert.ok(template, 'Thiếu template thẻ lịch sử');
  assert.match(template, /class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-on-surface-variant"/);
  assert.match(template, /data-booking-footer class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t"/);
  assert.match(template, /data-booking-actions class="flex flex-wrap items-center gap-2">[\s\S]*?data-cancel-action[\s\S]*?data-primary-action[\s\S]*?data-detail-link[\s\S]*?data-soon-action[\s\S]*?<\/div>/);
  for (const selector of ['data-cancel-action', 'data-primary-action', 'data-detail-link', 'data-soon-action']) {
    assert.ok(template.includes(selector), `Thiếu nút ${selector}`);
  }
  assert.match(template, /<span>Xem chi tiết<\/span>/);
  assert.match(historyPage, /const label = booking\.display_status_code === 'COMPLETED' \? 'Đánh giá' : 'Đặt lại'/);
  assert.match(historyPage, /detailAction\.classList\.replace\('py-2', 'py-2\.5'\)/);
});

test('thẻ chỉ dùng class xuất hiện trong mockup', () => {
  const template = /<template id="booking-card-template">([\s\S]*?)<\/template>/.exec(historyHtml)?.[1];
  assert.ok(template, 'Thiếu template thẻ lịch sử');
  const expected = classNames(historyMockup);
  const actual = classNames(template);
  expected.add('flex-wrap');
  for (const name of runtimeCardClassNames()) actual.add(name);
  actual.delete('data');
  actual.delete(legacyMaterialIconClass);
  const extra = [...actual].filter((name) => !expected.has(name));
  assert.deepEqual(extra, []);
});

test('nút Hủy chỉ hiện khi đơn đủ điều kiện', () => {
  const statuses = [
    ['CONFIRMED', 'UPCOMING', true],
    ['CONFIRMED', 'IN_PROGRESS', false],
    ['PENDING', 'PENDING', true],
    ['COMPLETED', 'COMPLETED', false],
    ['CANCELLED', 'CANCELLED', false],
    ['PENDING', 'EXPIRED', false]
  ];
  for (const [status, displayStatusCode, expected] of statuses) {
    assert.equal(canCancelBooking({ status, display_status_code: displayStatusCode }), expected);
  }
  assert.match(historyHtml, /data-cancel-action[^>]*hidden/);
  assert.match(historyPage, /cancelAction\.hidden = !state\.canCancelBooking\(booking\)/);
});

test('PENDING còn hạn hiển thị nhãn, đồng hồ và nút tiếp tục thanh toán', () => {
  const view = getBookingPresentation(booking('PENDING', 'PENDING'));
  assert.equal(view.action, 'continue-payment');
  assert.equal(view.href, '/thanh-toan.html?booking_id=42');
  assert.equal(view.remainingSeconds, 90);
  assert.equal(view.label, 'Chờ thanh toán');
});

test('CONFIRMED hiển thị nút mở vé', () => {
  const view = getBookingPresentation(booking('CONFIRMED', 'UPCOMING'));
  assert.equal(view.action, 'view-ticket');
  assert.equal(view.href, '/ve-dien-tu.html?booking_id=42&from=%2Flich-su-dat-san.html');
  assert.equal(view.label, 'Sắp tới');
});

test('CONFIRMED đang diễn ra vẫn hiển thị nút mở vé', () => {
  const view = getBookingPresentation(booking('CONFIRMED', 'IN_PROGRESS'));
  assert.equal(view.action, 'view-ticket');
  assert.equal(view.label, 'Đang trong trận');
});

test('Đơn hết hạn không điều hướng tới luồng đặt lại chưa được hỗ trợ', () => {
  const view = getBookingPresentation(booking('PENDING', 'EXPIRED'));
  assert.equal(view.action, 'view-details');
  assert.equal(view.href, '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Flich-su-dat-san.html');
  assert.equal(view.remainingSeconds, null);
});

test('COMPLETED và CANCELLED mở trang chi tiết, không mở vé', () => {
  for (const [status, code] of [['COMPLETED', 'COMPLETED'], ['CANCELLED', 'CANCELLED']]) {
    const view = getBookingPresentation(booking(status, code));
    assert.equal(view.action, 'view-details');
    assert.equal(view.href, '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Flich-su-dat-san.html');
  }
});

test('PENDING không bao giờ hiển thị QR hoặc stepper', () => {
  const view = getBookingPresentation(booking('PENDING', 'PENDING'));
  assert.equal(view.showQr, false);
  assert.equal(view.showStepper, false);
});

test('Nhãn trạng thái dùng đúng thuật ngữ nghiệp vụ', () => {
  assert.deepEqual(
    ['PENDING', 'UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']
      .map(getBookingStatusLabel),
    ['Chờ thanh toán', 'Sắp tới', 'Đang trong trận', 'Hoàn thành', 'Đã hủy', 'Hết hạn']
  );
});

test('404 chỉ quyết định hiện trạng thái không tìm thấy', () => {
  assert.equal(getBookingErrorAction(404), 'not-found');
  assert.deepEqual(getBookingErrorView(404), {
    action: 'not-found',
    title: 'Không tìm thấy đơn',
    message: '',
    showRetry: false
  });
});

test('401 chuyển người dùng đến đăng nhập', () => {
  assert.equal(getBookingErrorAction(401), 'login');
  assert.equal(getBookingErrorView(401).action, 'login');
});

test('Định dạng đồng hồ giữ phút và giây', () => {
  assert.equal(formatCountdown(600), '10:00');
  assert.equal(formatCountdown(59), '00:59');
  assert.equal(formatCountdown(-1), '00:00');
});

test('biến số liệu lịch sử thành nhãn và số đếm hiển thị', () => {
  assert.deepEqual(getBookingSummaryPresentation({
    upcoming_count: 2,
    completed_count: 3,
    total_spent: '1234567',
    counts_by_status: {
      'Chờ thanh toán': 1,
      'Sắp tới/Đang trong trận': 2,
      'Hoàn thành': 3,
      'Đã hủy': 4,
      'Hết hạn': 5
    }
  }), {
    upcomingCount: '2',
    completedCount: '3',
    totalSpent: '1.234.567 đ',
    counts: {
      all: '15',
      upcoming: '2',
      'payment-pending': '1',
      completed: '3',
      cancelled: '4',
      expired: '5'
    }
  });
});

test('rejects invalid summary values instead of displaying placeholders', () => {
  assert.throws(() => getBookingSummaryPresentation({
    upcoming_count: -1,
    completed_count: 0,
    total_spent: '0',
    counts_by_status: {}
  }), /Số lượng trạng thái/);
});
