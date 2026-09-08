const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

test('build targets match the declared minimum browser versions', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file)))
  const targets = read('.babelrc').targets
  assert.equal(targets.chrome, read('src/chrome/manifest/chrome.json').minimum_chrome_version)
  assert.equal(targets.firefox, read('src/firefox/manifest/firefox.json')
    .browser_specific_settings.gecko.strict_min_version.split('.')[0])
})

test('development and production bundles use CSP-safe source maps', () => {
  const root = path.resolve(__dirname, '..')
  const configPath = path.join(root, 'webpack.config.js')
  const original = { ...process.env }
  try {
    for (const BROWSER of ['chrome', 'firefox']) {
      for (const NODE_ENV of ['development', 'production']) {
        Object.assign(process.env, { BROWSER, NODE_ENV })
        delete require.cache[configPath]
        for (const config of require(configPath)) {
          assert.equal(typeof config.devtool, 'string', `${BROWSER} ${NODE_ENV}`)
          assert.doesNotMatch(config.devtool, /eval/, `${BROWSER} ${NODE_ENV}`)
          const copy = config.plugins?.find(plugin => plugin.constructor.name === 'CopyPlugin')
          const merge = copy?.patterns.find(pattern => pattern.to === 'manifest.json')
          if (merge) {
            const manifests = [`src/${BROWSER}/manifest/${BROWSER}.json`, 'src/shared/manifest/base.json']
              .map(file => fs.readFileSync(path.join(root, file)))
            assert.deepEqual(JSON.parse(merge.transformAll(manifests.map(data => ({ data })))),
              Object.assign({}, ...manifests.map(data => JSON.parse(data))))
          }
        }
      }
    }
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(original, key)) delete process.env[key]
    }
    Object.assign(process.env, original)
    delete require.cache[configPath]
  }
})
