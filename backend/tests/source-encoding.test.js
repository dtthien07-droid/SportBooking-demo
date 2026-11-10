'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '../..');
const sourceExtensions = new Set(['.js', '.html', '.css', '.json', '.sql']);

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(filePath);
    return sourceExtensions.has(path.extname(entry.name).toLowerCase()) ? [filePath] : [];
  });
}

test('frontend and backend source files use UTF-8 without replacement question marks or BOM', () => {
  const sourceFiles = [
    ...collectSourceFiles(path.join(repositoryRoot, 'frontend')),
    ...collectSourceFiles(path.join(repositoryRoot, 'backend', 'src'))
  ];
  const violations = [];

  for (const filePath of sourceFiles) {
    const bytes = fs.readFileSync(filePath);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      violations.push(`${path.relative(repositoryRoot, filePath)}: UTF-8 BOM`);
    }
    const content = bytes.toString('utf8');
    if (/\?{3,}/.test(content)) {
      violations.push(`${path.relative(repositoryRoot, filePath)}: three or more consecutive question marks`);
    }
  }

  assert.deepEqual(violations, []);
});
