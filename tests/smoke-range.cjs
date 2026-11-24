// Run a contiguous subset of the Node regression suite by test title.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const file = path.join(__dirname, 'smoke.test.js');
const source = fs.readFileSync(file, 'utf8');
const names = [...source.matchAll(/^test\(['"]([^'"]+)['"]/gm)].map(m => m[1]);
const from = Math.max(0, Number(process.argv[2]) || 0);
const to = Math.min(names.length, Number(process.argv[3]) || names.length);
const escaped = name => [...name].map(char =>
    /[a-zA-Z0-9 ]/.test(char) ? char : '\\' + char).join('');
const pattern = '^(?:' + names.slice(from, to).map(escaped).join('|') + ')$';
console.log('Testing cases', from, '-', to - 1, 'of', names.length);
const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, file], {stdio: 'inherit'});
process.exit(result.status === null ? 1 : result.status);
