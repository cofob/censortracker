const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

// Load ES modules with explicit browser and network substitutes.
module.exports = function loadModule(entry, mocks = {}, globals = {}) {
  const root = path.resolve(__dirname, '../src/shared/js')
  const modules = new Map()
  function load(file) {
    const name = path.basename(file, '.js')
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] }
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    const source = babel.transformSync(fs.readFileSync(file, 'utf8'), {
      configFile: false, babelrc: false,
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    }).code
    vm.runInNewContext(source, {
      module, exports: module.exports,
      require: specifier => {
        if (specifier.startsWith('Background/')) {
          return load(path.join(root, 'background', specifier.slice(11) + '.js'))
        }
        return specifier.startsWith('.')
          ? load(path.resolve(path.dirname(file), specifier + '.js'))
          : require(specifier)
      },
      URL, URLSearchParams, AbortController, TextDecoder, TextEncoder,
      Uint8Array, crypto: globalThis.crypto, performance, console,
      setTimeout, clearTimeout, fetch, atob, btoa, ...globals,
    }, { filename: file })
    return module.exports
  }
  return load(path.join(root, entry + '.js'))
}
