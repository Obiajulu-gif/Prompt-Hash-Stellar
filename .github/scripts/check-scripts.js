const pkg = require('./package.json');
const scripts = pkg.scripts || {};
const has = (name) => Boolean(scripts[name]);
const placeholder = (scripts.test || '').includes('no test specified');
const fs = require('node:fs');
const output = [
  `has_lint=${has('lint')}`,
  `has_test=${has('test') && !placeholder}`,
  `has_build=${has('build')}`,
  ''
].join('\n');
fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
