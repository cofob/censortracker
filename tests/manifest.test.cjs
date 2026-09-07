const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

test('build targets match the declared minimum browser versions', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file)))
  const targets = read('.babelrc').presets[0][1].targets
  assert.equal(targets.chrome, read('src/chrome/manifest/chrome.json').minimum_chrome_version)
  assert.equal(targets.firefox, read('src/firefox/manifest/firefox.json')
    .browser_specific_settings.gecko.strict_min_version.split('.')[0])
})
