const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('build targets match the declared minimum browser versions', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file)))
  const targets = read('.babelrc').presets[0][1].targets
  assert.equal(targets.chrome, read('src/chrome/manifest/chrome.json').minimum_chrome_version)
  assert.equal(targets.firefox, read('src/firefox/manifest/firefox.json')
    .browser_specific_settings.gecko.strict_min_version.split('.')[0])
})

test('development and production bundles use CSP-safe source maps', () => {
  const root = path.resolve(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'webpack.config.js'), 'utf8')
  for (const BROWSER of ['chrome', 'firefox']) {
    for (const NODE_ENV of ['development', 'production']) {
      const module = { exports: {} }
      vm.runInNewContext(source, {
        module, __dirname: root,
        process: { env: { BROWSER, NODE_ENV } },
        require: name => name === 'dotenv' ? { config() {} } : require(name),
      })
      for (const config of module.exports) {
        assert.equal(typeof config.devtool, 'string', `${BROWSER} ${NODE_ENV}`)
        assert.doesNotMatch(config.devtool, /eval/, `${BROWSER} ${NODE_ENV}`)
      }
    }
  }
})
