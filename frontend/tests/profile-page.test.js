'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const pagePath = path.join(root, 'frontend', 'profile', 'profile.html');
const viewPath = path.join(root, 'frontend', 'profile', 'profile-view.js');
const stylePath = path.join(root, 'frontend', 'profile', 'profile.css');
const appPath = path.join(root, 'frontend', 'shared', 'app.js');
const pageHtml = fs.readFileSync(pagePath, 'utf8');
const pageCss = fs.readFileSync(stylePath, 'utf8');

function createNode(dataset = {}) {
  return {
    dataset,
    hidden: false,
    disabled: false,
    textContent: '',
    attributes: new Map(),
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  };
}

function createForm(names, formName) {
  const fields = Object.fromEntries(names.map((name) => [name, createNode()]));
  const errors = new Map(names.map((name) => [name, createNode()]));
  const button = createNode({ idleLabel: 'idle', loadingLabel: 'loading' });
  const elements = {
    ...fields,
    namedItem(name) {
      return fields[name] || null;
    }
  };
  const form = {
    dataset: { form: formName },
    elements,
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    querySelector(selector) {
      if (selector === '[data-submit]') return button;
      const match = selector.match(/^\[data-field-error="([^"]+)"\]$/);
      return match ? errors.get(match[1]) || null : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-field-error]') return [...errors.values()];
      if (selector === '[aria-invalid="true"]') {
        return Object.values(fields).filter((field) => field.attributes.get('aria-invalid') === 'true');
      }
      return [];
    },
    reset() {
      Object.values(fields).forEach((field) => { field.value = ''; });
    }
  };
  return { form, fields, errors, button };
}

function createProfileHarness(fetchResponse) {
  const user = {
    fullName: 'Hồ sơ kiểm tra',
    email: 'kiemtra@example.test',
    phone: '0987654321',
    gender: 'FEMALE',
    skillLevel: 'INTERMEDIATE',
    role: 'USER'
  };
  const profile = createForm(['fullName', 'email', 'phone', 'gender', 'skillLevel'], 'profile');
  const password = createForm(
    ['currentPassword', 'newPassword', 'confirmNewPassword'],
    'password'
  );
  const nodes = {
    '[data-notice]': createNode(),
    '[data-back]': createNode(),
    '[data-retry]': createNode(),
    '[data-form="profile"]': profile.form,
    '[data-form="password"]': password.form,
    '[data-profile-role]': createNode(),
    '[data-profile-loading]': createNode(),
    '[data-profile-error]': createNode(),
    '[data-profile-content]': createNode()
  };
  const calls = [];
  const document = {
    body: { dataset: { page: 'profile' } },
    referrer: '',
    querySelector(selector) {
      return nodes[selector] || null;
    }
  };
  const window = {
    location: {
      pathname: '/profile/profile.html',
      search: '',
      hash: '',
      replace() {}
    },
    history: { length: 1 },
    SportBookingHeaderReady: Promise.resolve(user),
    SportBookingHeaderAuth: {
      async redirectIfAccountLocked() {
        return false;
      }
    }
  };
  const response = fetchResponse || {
    status: 200,
    ok: true,
    async json() {
      return { user };
    }
  };
  class TestFormData {
    constructor(form) {
      this.form = form;
    }
    entries() {
      return Object.entries(this.form.elements)
        .filter(([name]) => name !== 'namedItem')
        .map(([name, field]) => [name, field.value]);
    }
  }
  const sandbox = {
    document,
    window,
    FormData: TestFormData,
    TextEncoder,
    URL,
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response;
    }
  };

  vm.runInNewContext(fs.readFileSync(appPath, 'utf8'), sandbox);
  return { nodes, profile, password, calls, user };
}

async function settleProfileLoad() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('profile markup keeps labels, form identifiers, and API error targets connected', () => {
  const ids = new Set([...pageHtml.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const labels = [...pageHtml.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/g)];
  const describedBy = [...pageHtml.matchAll(/\baria-describedby=["']([^"']+)["']/g)];
  const expectedFields = [
    ['profile-full-name', 'fullName'],
    ['profile-email', 'email'],
    ['profile-phone', 'phone'],
    ['profile-gender', 'gender'],
    ['profile-skill', 'skillLevel'],
    ['current-password', 'currentPassword'],
    ['new-password', 'newPassword'],
    ['confirm-new-password', 'confirmNewPassword']
  ];

  for (const [id, name] of expectedFields) {
    assert.ok(ids.has(id), `Missing form control id ${id}`);
    assert.match(pageHtml, new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*\\bname=["']${name}["']`));
  }
  for (const [, target] of labels) assert.ok(ids.has(target), `Missing label target ${target}`);
  for (const [, targets] of describedBy) {
    for (const target of targets.split(/\s+/)) assert.ok(ids.has(target), `Missing description ${target}`);
  }

  const appSource = fs.readFileSync(appPath, 'utf8');
  for (const selector of [
    'data-profile-loading',
    'data-profile-error',
    'data-profile-content',
    'data-profile-role',
    'data-retry',
    'data-form="profile"',
    'data-form="password"',
    'data-field-error'
  ]) {
    assert.ok(pageHtml.includes(selector), `Missing selector used by shared app logic: ${selector}`);
    assert.ok(appSource.includes(selector), `Shared app selector is no longer covered: ${selector}`);
  }
  assert.match(pageCss, /\.profile-page\s+\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(pageCss, /@media\s*\(max-width:\s*620px\)/);
});

test('profile presentation uses API values as text and omits mockup sample content', () => {
  const viewSource = fs.readFileSync(viewPath, 'utf8');
  const mockupSamples = [
    'Người dùng mới',
    'CLB Cầu lông Cầu Giấy Pro',
    '1900 8899',
    'Quận Cầu Giấy, Nam Từ Liêm',
    '15%',
    '0 giờ',
    '0 đối tác',
    '100%',
    '100/100 (Khởi tạo)',
    '15.000+',
    '0/0 trận',
    '18:00 – 21:00',
    'Thứ 3',
    'Thứ 5',
    'Thứ 7',
    'Mới tham gia',
    'Tầng 6, Tháp Thể Thao Đống Đa',
    'SportBooking Hà Nội'
  ];
  assert.match(viewSource, /\.textContent\s*=/);
  assert.doesNotMatch(viewSource, /\.innerHTML\s*=/i);
  assert.doesNotMatch(fs.readFileSync(appPath, 'utf8'), /\.innerHTML\s*=/i);
  assert.doesNotMatch(pageHtml, /material-symbols-outlined|[\uE000-\uF8FF]/);
  assert.match(pageHtml, /<svg\b[^>]*data-sb-icon=/);
  const icons = require(path.join(root, 'frontend', 'shared', 'icons.js'));
  const iconNames = [...pageHtml.matchAll(/data-sb-icon=["']([^"']+)["']/g)]
    .map((match) => match[1]);
  for (const name of iconNames) assert.ok(icons.names.has(name), `Unknown SVG icon ${name}`);
  for (const sample of mockupSamples) {
    assert.ok(!pageHtml.includes(sample), `Mockup sample must not appear: ${sample}`);
    assert.ok(!viewSource.includes(sample), `Mockup sample must not appear: ${sample}`);
  }
});

test('saving profile PATCHes only supported fields and shows API success', async () => {
  const updatedUser = {
    fullName: 'Tên cập nhật',
    email: 'kiemtra@example.test',
    phone: '0912345678',
    gender: 'MALE',
    skillLevel: 'GOOD',
    role: 'USER'
  };
  const harness = createProfileHarness({
    status: 200,
    ok: true,
    async json() {
      return { user: updatedUser };
    }
  });
  await settleProfileLoad();
  assert.equal(harness.nodes['[data-profile-loading]'].hidden, true);
  assert.equal(harness.nodes['[data-profile-error]'].hidden, true);
  assert.equal(harness.nodes['[data-profile-content]'].hidden, false);
  harness.profile.fields.fullName.value = updatedUser.fullName;
  harness.profile.fields.phone.value = updatedUser.phone;
  harness.profile.fields.gender.value = updatedUser.gender;
  harness.profile.fields.skillLevel.value = updatedUser.skillLevel;

  await harness.profile.form.listeners.submit({ preventDefault() {} });

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, '/api/v1/users/me');
  assert.equal(harness.calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(harness.calls[0].options.body), {
    fullName: 'Tên cập nhật',
    phone: '0912345678',
    gender: 'MALE',
    skillLevel: 'GOOD'
  });
  assert.equal(harness.nodes['[data-notice]'].textContent, 'Đã cập nhật hồ sơ.');
  assert.equal(harness.nodes['[data-notice]'].dataset.kind, 'success');
});

test('profile API conflicts keep the existing phone error and message', async () => {
  const harness = createProfileHarness({
    status: 409,
    ok: false,
    async json() {
      return { error: { message: 'Phone already used.' } };
    }
  });
  await settleProfileLoad();
  harness.profile.fields.fullName.value = 'Hồ sơ kiểm tra';
  harness.profile.fields.phone.value = '0912345678';

  await harness.profile.form.listeners.submit({ preventDefault() {} });

  assert.equal(harness.profile.errors.get('phone').textContent, 'Số điện thoại này đã được sử dụng.');
  assert.equal(
    harness.nodes['[data-notice]'].textContent,
    'Số điện thoại này đã được đăng ký bởi tài khoản khác.'
  );
});

test('invalid profile input keeps the current validation and avoids an API request', async () => {
  const harness = createProfileHarness();
  await settleProfileLoad();
  harness.profile.fields.fullName.value = 'Hồ sơ kiểm tra';
  harness.profile.fields.phone.value = 'sai';

  await harness.profile.form.listeners.submit({ preventDefault() {} });

  assert.equal(harness.calls.length, 0);
  assert.equal(
    harness.profile.errors.get('phone').textContent,
    'Số điện thoại cần có từ 8 đến 15 chữ số.'
  );
  assert.equal(
    harness.nodes['[data-notice]'].textContent,
    'Vui lòng kiểm tra lại thông tin hồ sơ.'
  );
});

test('changing password PATCHes current/new password and shows success', async () => {
  const harness = createProfileHarness({
    status: 204,
    ok: true
  });
  await settleProfileLoad();
  harness.password.fields.currentPassword.value = 'Current-pass-1';
  harness.password.fields.newPassword.value = 'New-password-1';
  harness.password.fields.confirmNewPassword.value = 'New-password-1';

  await harness.password.form.listeners.submit({ preventDefault() {} });

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, '/api/v1/users/me/password');
  assert.equal(harness.calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(harness.calls[0].options.body), {
    currentPassword: 'Current-pass-1',
    newPassword: 'New-password-1'
  });
  assert.equal(harness.nodes['[data-notice]'].textContent, 'Đã đổi mật khẩu thành công.');
  assert.equal(harness.nodes['[data-notice]'].dataset.kind, 'success');
});

test('invalid password input keeps current messages and avoids an API request', async () => {
  const harness = createProfileHarness();
  await settleProfileLoad();
  harness.password.fields.currentPassword.value = 'current';
  harness.password.fields.newPassword.value = 'short';
  harness.password.fields.confirmNewPassword.value = 'different';

  await harness.password.form.listeners.submit({ preventDefault() {} });

  assert.equal(harness.calls.length, 0);
  assert.equal(
    harness.password.errors.get('newPassword').textContent,
    'Mật khẩu mới cần có ít nhất 8 ký tự và tối đa 72 byte UTF-8.'
  );
  assert.equal(
    harness.password.errors.get('confirmNewPassword').textContent,
    'Mật khẩu nhập lại chưa khớp.'
  );
  assert.equal(
    harness.nodes['[data-notice]'].textContent,
    'Vui lòng kiểm tra lại thông tin đổi mật khẩu.'
  );
});
