'use strict';

const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const test = require('node:test');
const {
  assertExportRows,
  createUsersExport,
  escapeTextCell
} = require('../src/admin/bookings-export');

test('booking export escapes every formula-leading text character', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n']) {
    assert.equal(escapeTextCell(`${prefix}value`), `'${prefix}value`);
  }
  assert.equal(escapeTextCell('SPB-20261114-000001'), 'SPB-20261114-000001');
  assert.equal(escapeTextCell(null), '');
});

test('shared report workbook escapes formula-leading user cells and never exports secrets', async () => {
  const prefixes = ['=', '+', '-', '@'];
  const users = prefixes.map((prefix, index) => ({
    id: String(index + 1),
    full_name: `${prefix}formula-${index}`,
    email: `user-${index}@example.test`,
    phone: '+84900000000',
    account_status: index % 2 ? 'ADMIN_LOCKED' : 'ACTIVE',
    created_at: '2026-11-15T00:00:00.000Z',
    password_hash: 'must-not-be-exported',
    session_token: 'must-not-be-exported'
  }));
  const result = await createUsersExport({
    users,
    summary: {
      total_users: 4,
      active_users: 2,
      locked_users: 2,
      new_users_this_month: 4
    },
    now: new Date('2026-11-15T01:53:00.000Z')
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const sheet = workbook.getWorksheet('Người dùng');
  prefixes.forEach((prefix, index) => {
    assert.equal(sheet.getCell(index + 2, 2).value, `'${prefix}formula-${index}`);
  });
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => row.eachCell((cell) => {
      assert.notEqual(cell.value, 'must-not-be-exported');
      if (typeof cell.value === 'string') {
        assert.doesNotMatch(cell.value, /password_hash|session_token/i);
      }
    }));
  }
});

test('shared report exports reject sheets above 5000 data rows', () => {
  assert.throws(
    () => assertExportRows(Array.from({ length: 5001 }, () => ({}))),
    (error) => error.status === 400
      && error.message === 'Quá nhiều dòng, hãy lọc thu hẹp'
  );
});
