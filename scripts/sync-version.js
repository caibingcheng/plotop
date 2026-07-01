const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runGit(args) {
  try {
    const result = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function bumpVersion(version) {
  const parts = version.split('.');
  const last = parts.length - 1;
  parts[last] = String(parseInt(parts[last], 10) + 1);
  return parts.join('.');
}

const description = runGit(['describe', '--tags', '--long', '--always', '--abbrev=9']);
if (!description) {
  console.log('No git describe output found, skipping version sync.');
  process.exit(0);
}

const match = description.match(/^[vV]?(\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?$/);
if (!match) {
  console.log(`Git describe output "${description}" does not match expected format, skipping version sync.`);
  process.exit(0);
}

const baseVersion = match[1];
const distance = match[2];
const hash = match[3];

let version;
if (!distance || distance === '0') {
  version = baseVersion;
} else {
  version = `${bumpVersion(baseVersion)}-dev.${distance}+g${hash}`;
}

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.version === version) {
  console.log(`package.json version already "${version}".`);
  process.exit(0);
}

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Synced package.json version to "${version}" from "${description}".`);
