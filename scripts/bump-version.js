#!/usr/bin/env node

/**
 * bump-version.js
 *
 * Bumps the version in package.json.
 *
 * Usage: node scripts/bump-version.js [patch|minor|major]
 *
 * Output: NEW_VERSION=x.y.z to stdout
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagePath = join(__dirname, '..', 'package.json');

const bumpType = process.argv[2] || 'patch';

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error(`Invalid bump type: ${bumpType}`);
  console.error('Usage: node scripts/bump-version.js [patch|minor|major]');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

let newVersion;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

// 0.1.19 is a permanently burned npm slot (unpublished); publishing it hard-403s, so skip it.
if (newVersion === '0.1.19') {
  newVersion = '0.1.20';
}

pkg.version = newVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

console.error(`Bumped version: ${major}.${minor}.${patch} -> ${newVersion} (${bumpType})`);
console.log(`NEW_VERSION=${newVersion}`);
