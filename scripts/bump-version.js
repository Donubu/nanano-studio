#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Incrementar patch version
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Version bumped to ${pkg.version}`);
