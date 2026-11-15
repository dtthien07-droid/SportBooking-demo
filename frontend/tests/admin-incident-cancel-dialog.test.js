'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { canSubmit } = require('../admin/incident-cancel-dialog.js');

const dialogSource = fs.readFileSync(require.resolve('../admin/incident-cancel-dialog.js'), 'utf8');

test('canSubmit enables only valid trimmed incident reasons when not submitting', () => {
  assert.equal(canSubmit('', false), false);
  assert.equal(canSubmit('  ab  ', false), false);
  assert.equal(canSubmit('  abc  ', false), true);
  assert.equal(canSubmit('x'.repeat(501), false), false);
  assert.equal(canSubmit('valid reason', true), false);
});

test('incident confirmation button is associated with the form that handles submit', () => {
  assert.match(dialogSource, /form\.id = 'incidentCancelForm'/);
  assert.match(dialogSource, /submitButton\.setAttribute\('form', form\.id\)/);
});
