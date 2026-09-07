const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '../src/shared/js/background')
const clone = value => JSON.parse(JSON.stringify(value))
const normalPac = 'function FindProxyForURL(url, host) { return "HTTPS normal.example:443"; }'

function fixture(options = {}) {
  const storage = { enableExtension: true, useProxy: true, proxyServerURI: 'normal.example:443', ...options.storage }
  const original = options.value || (options.firefox
    ? { proxyType: 'autoConfig', autoConfigUrl: 'data:text/plain,' + encodeURIComponent(normalPac) }
    : { mode: 'pac_script', pacScript: { data: normalPac } })
  let settings = { value: original, levelOfControl: options.control || 'controlled_by_this_extension' }
  const listeners = new Set()
  const routeListeners = new Set()
  const events = []
  const browser = {
    isFirefox: !!options.firefox,
    storage: {
      local: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: storage[keys] }
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, storage[key]]))
          return { ...keys, ...storage }
        },
        set: async values => Object.assign(storage, clone(values)),
        remove: async keys => { for (const key of [].concat(keys)) delete storage[key] },
      },
      onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    },
    proxy: { settings: {
      onChange: { addListener: fn => routeListeners.add(fn), removeListener: fn => routeListeners.delete(fn) },
      get: async () => clone(settings),
      set: async ({ value }) => {
        events.push('set')
        settings = { value: clone(value), levelOfControl: 'controlled_by_this_extension' }
      },
      clear: async () => {
        events.push('clear')
        settings = { value: options.inherited || { mode: 'direct' }, levelOfControl: 'controllable_by_this_extension' }
      },
    } },
  }
  const mocks = {
    'browser-api': { default: browser },
    proxy: { default: {
      setProxy: async () => events.push('refresh'),
      ping: async () => events.push('knock'),
      getProxyingRules: async () => options.noProxy ? {} : {
        proxyServerURI: 'retry.example:443', proxyServerProtocol: options.protocol || 'HTTPS',
      },
    } },
    'background-rpc': { callBackground: () => { throw new Error('Unexpected RPC') } },
    ...options.mocks,
  }
  const modules = {}
  const route = host => {
    const value = settings.value
    const script = options.firefox
      ? decodeURIComponent(value.autoConfigUrl.split(',').slice(1).join(','))
      : value.pacScript.data
    const scope = {}
    vm.runInNewContext(script, scope)
    return scope.FindProxyForURL('https://' + host, host)
  }
  function load(name) {
    name = path.basename(name).replace(/\.js$/, '')
    if (mocks[name]) return { __esModule: true, ...mocks[name] }
    if (modules[name]) return modules[name].exports
    const module = { exports: {} }
    modules[name] = module
    const source = babel.transformSync(fs.readFileSync(path.join(root, name + '.js'), 'utf8'), {
      configFile: false, babelrc: false,
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    }).code
    vm.runInNewContext(source, {
      module, exports: module.exports, require: load,
      URL, AbortController, TextEncoder, console: { warn() {}, info() {}, error() {}, group() {}, groupEnd() {}, log() {}, table() {} },
      setTimeout: (fn, delay) => setTimeout(fn, options.fastTimeout ? 5 : delay), clearTimeout,
      fetch: async (url, init) => {
        if (url.startsWith('data:')) return { text: async () => decodeURIComponent(url.split(',').slice(1).join(',')) }
        events.push('fetch')
        return options.fetch(url, init, { route, storage, listeners })
      },
    }, { filename: name + '.js' })
    return module.exports
  }
  return { load, storage, events, route, original, settings: () => settings, listeners, routeListeners, browser }
}

const response = data => ({ ok: true, json: async () => data })

test('a service exclusion prevents remote retries', async () => {
  let calls = 0
  const state = fixture({ storage: { ignoredHosts: ['example.com'] },
    fetch: async () => { calls++; throw new Error('offline') } })
  await assert.rejects(state.load('service-request').requestService('https://api.example.com', Array.isArray),
    /Restricted services cannot use a proxy override/)
  assert.equal(calls, 1)
})

test('an exclusion added during retry PAC installation prevents the request', async () => {
  let calls = 0
  const state = fixture({ fetch: async () => { calls++; throw new Error('offline') } })
  const setting = state.browser.proxy.settings
  const originalSet = setting.set
  setting.set = async args => {
    await originalSet(args)
    if (state.events.includes('knock')) state.storage.ignoredHosts = ['example.com']
  }
  await assert.rejects(state.load('service-request').requestService('https://api.example.com', Array.isArray))
  assert.equal(calls, 1)
  assert.equal(state.storage.serviceRouteSnapshot, undefined)
})

for (const firefox of [false, true]) {
  for (const host of ['192.168.1.1', '[64:ff9b:1::a00:1]', 'router.local']) {
    test(`local services never retry through a remote proxy: ${host}, Firefox=${firefox}`, async () => {
      let calls = 0
      const state = fixture({ firefox, fetch: async () => { calls++; throw new Error('offline') } })
      await assert.rejects(state.load('service-request').requestService(`http://${host}/registry.json`, Array.isArray),
        /Restricted services cannot use a proxy override/)
      assert.equal(calls, 1)
      assert.equal(state.storage.serviceRouteSnapshot, undefined)
    })
  }
}

for (const firefox of [false, true]) {
  test(`country-restricted services cannot use temporary proxy routes, Firefox=${firefox}`, async () => {
    let calls = 0
    const blocked = 'function FindProxyForURL() { return "PROXY 127.0.0.1:0"; }'
    const value = firefox
      ? { proxyType: 'autoConfig', autoConfigUrl: 'data:text/plain,' + encodeURIComponent(blocked) }
      : { mode: 'pac_script', pacScript: { data: blocked, mandatory: true } }
    const state = fixture({ firefox, value, storage: { siteCountryRules: { 'example.com': ['RU'] } },
      fetch: async () => { calls++; throw new Error('offline') } })
    await assert.rejects(state.load('service-request').requestService('https://api.example.com', Array.isArray),
      /Restricted services cannot use a proxy override/)
    assert.equal(calls, 0)
    assert.equal(state.route('api.example.com'), 'PROXY 127.0.0.1:0')
    assert.equal(state.storage.serviceRouteSnapshot, undefined)
  })

  test(`direct-first exact-host routing and restoration (${firefox ? 'Firefox' : 'Chrome'})`, async () => {
    const state = fixture({ firefox, fetch: async (url, init, { route }) => {
      assert.equal(route('service.example'), 'DIRECT')
      assert.equal(route('service.example.'), 'DIRECT')
      assert.equal(route('other.example'), 'HTTPS normal.example:443')
      assert.equal(route('sub.service.example'), 'HTTPS normal.example:443')
      return response([])
    } })
    await state.load('service-request').requestService('https://service.example', Array.isArray)
    if (!firefox) assert.deepEqual(state.settings().value, state.original)
    else assert.equal(state.route('service.example'), 'HTTPS normal.example:443')
    assert.equal(state.storage.serviceRouteSnapshot, undefined)
    // The routing revision listener stays registered; request listeners do not.
    assert.equal(state.listeners.size, 1)
    assert.ok(!state.events.includes('knock'))
  })
}

for (const failure of ['network', 'http', 'invalid', 'json', 'timeout']) {
  test(`retry after ${failure}, knock first, restore normal route`, async () => {
    let calls = 0
    const state = fixture({ fastTimeout: true, fetch: async (url, init, { route }) => {
      if (++calls === 1) {
        if (failure === 'network') throw new Error('network')
        if (failure === 'http') return { ok: false, status: 503 }
        if (failure === 'invalid') return response({})
        if (failure === 'json') return { ok: true, json: async () => { throw new Error('JSON') } }
        return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout'))))
      }
      assert.equal(route('service.example'), 'HTTPS retry.example:443')
      assert.equal(route('other.example'), 'HTTPS normal.example:443')
      assert.ok(state.events.includes('knock'))
      return response([])
    } })
    const result = await state.load('service-request').requestService('https://service.example', Array.isArray)
    assert.equal(result.viaProxy, true)
    assert.equal(calls, 2)
    assert.deepEqual(state.settings().value, state.original)
  })
}

for (const options of [
  { noProxy: true }, { storage: { useProxy: false } },
  { storage: { enableExtension: false } }, { control: 'controlled_by_other_extensions' },
]) {
  test(`no unsafe fallback: ${JSON.stringify(options)}`, async () => {
    let calls = 0
    const state = fixture({ ...options, fetch: async () => { calls++; throw new Error('offline') } })
    await assert.rejects(state.load('service-request').requestService('https://service.example', Array.isArray))
    assert.equal(calls, 1)
    assert.ok(!state.events.includes('knock'))
    assert.equal(state.storage.serviceRouteSnapshot, undefined)
    if (options.control) assert.ok(!state.events.includes('set'))
  })
}

test('both failures restore route; pending normal PAC update runs afterward', async () => {
  const state = fixture({ fetch: async () => { throw new Error('offline') } })
  const request = state.load('service-request').requestService('https://service.example', Array.isArray)
  const next = state.load('proxy-route').withProxyLock(async () => {
    assert.equal(state.storage.serviceRouteSnapshot, undefined)
    assert.deepEqual(state.settings().value, state.original)
  })
  await assert.rejects(request)
  await next
})

test('restart restores persisted route snapshot', async () => {
  const state = fixture()
  const routes = state.load('proxy-route')
  await routes.setServiceRoute('service.example', 'HTTPS retry.example:443')
  await routes.restoreServiceRoute()
  assert.deepEqual(state.settings().value, state.original)
  assert.equal(state.storage.serviceRouteSnapshot, undefined)
})

test('disabling proxy during retry aborts request and clears override', async () => {
  let calls = 0
  const state = fixture({ fetch: async (url, init, { storage, listeners }) => {
    if (++calls === 1) throw new Error('offline')
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('disabled')))
      storage.useProxy = false
      for (const listener of listeners) listener({ useProxy: { newValue: false } })
    })
  } })
  await assert.rejects(state.load('service-request').requestService('https://service.example', Array.isArray))
  assert.ok(state.events.includes('clear'))
  assert.equal(state.storage.serviceRouteSnapshot, undefined)
})

test('country mappings and validators', () => {
  const config = fixture().load('service-config')
  for (const country of ['AZ', 'BY', 'GE', 'KG', 'KZ', 'TR', 'UA', 'UZ']) {
    assert.equal(config.getRegionConfig(country).registryUrl,
      `https://censortracker.github.io/ctconf/registry/${country.toLowerCase()}.json`)
  }
  assert.equal(config.getRegionConfig('PL').registryUrl, null)
  assert.match(config.getRegionConfig('RU').registryUrl, /registry.ctreserve.de/)
  assert.equal(config.validCountry({ countryCode: 'PL' }), true)
  assert.equal(config.validCountry({ countryCode: 'invalid' }), false)
  assert.equal(config.validDomains(['example.com']), true)
  assert.equal(config.validDomains([null]), false)
  assert.equal(config.validORI([{ url: 'example.com', cooperationRefused: false }]), true)
  assert.equal(config.validORI([{}]), false)
})

for (const country of ['', 'RU', 'BY', 'PL']) {
  test(`region selection and failed registry cache: ${country || 'automatic'}`, async () => {
    const urls = []
    const state = fixture({ storage: {
      currentRegionCode: country, registryRegionCode: 'RU', domains: ['cached.example'],
    }, mocks: { 'service-request': { requestService: async url => {
      urls.push(url)
      if (url.includes('geo.')) return { data: { countryCode: 'PL' }, viaProxy: true }
      if (url.includes('disseminators')) return { data: [] }
      throw new Error('offline')
    } } } })
    await state.load('server').synchronizeInBackground({ syncProxy: false })
    assert.equal(state.storage.localConfig.countryCode, country || 'RU')
    assert.deepEqual(state.storage.domains, ['', 'RU'].includes(country) ? ['cached.example'] : [])
    assert.equal(urls.some(url => url.includes('geo.')), !country)
  })
}

test('proxy-only recovery does not request regional services', async () => {
  const urls = []
  const state = fixture({ mocks: { 'service-request': { requestService: async url => {
    urls.push(url)
    throw new Error('offline')
  } } } })
  await state.load('server').synchronizeInBackground({ syncRegistry: false })
  assert.deepEqual(urls, ['https://cozyquokka.net/api/proxy-list/'])
})

test('concurrent services have no overlapping temporary routes', async () => {
  let active = 0
  const state = fixture({ fetch: async (url, init, { route }) => {
    assert.equal(++active, 1)
    assert.equal(route(new URL(url).hostname), 'DIRECT')
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return response([])
  } })
  const { requestService } = state.load('service-request')
  await Promise.all([
    requestService('https://first.example', Array.isArray),
    requestService('https://second.example', Array.isArray),
  ])
  assert.deepEqual(state.settings().value, state.original)
})

for (const protocol of ['SOCKS5', 'HTTP']) {
  test(`configured proxy protocol: ${protocol}`, async () => {
    let calls = 0
    const state = fixture({ protocol, fetch: async (url, init, { route }) => {
      if (++calls === 1) throw new Error('offline')
      const pacProtocol = protocol === 'HTTP' ? 'PROXY' : protocol
      assert.equal(route('service.example'), `${pacProtocol} retry.example:443`)
      return response([])
    } })
    await state.load('service-request').requestService('https://service.example', Array.isArray)
    assert.deepEqual(state.settings().value, state.original)
  })
}

test('successful registry update replaces cached data', async () => {
  const state = fixture({ storage: { currentRegionCode: 'RU', registryRegionCode: 'RU', domains: ['old.example'] },
    mocks: { 'service-request': { requestService: async url => ({ data: url.includes('disseminators') ? [] : ['new.example'] }) } },
  })
  await state.load('server').synchronizeInBackground({ syncProxy: false })
  assert.deepEqual(state.storage.domains, ['new.example'])
  assert.deepEqual(state.storage.serviceErrors, [])
})

test('direct GeoIP selects country, proxied GeoIP does not', async () => {
  const state = fixture({ mocks: { 'service-request': { requestService: async url => {
    if (url.includes('geo.')) return { data: { countryCode: 'PL' }, viaProxy: false }
    return { data: [] }
  } } } })
  await state.load('server').synchronizeInBackground({ syncProxy: false })
  assert.equal(state.storage.localConfig.countryCode, 'PL')
  assert.equal(state.storage.geoIPStatus, 'direct')
})

for (const value of [{ mode: 'system' }, { mode: 'fixed_servers' }, { proxyType: 'system' }, { proxyType: 'manual' }]) {
  for (const useProxy of [false, true]) {
    test(`preserve external routes and distrust GeoIP: ${JSON.stringify(value)}, enabled=${useProxy}`, async () => {
      const state = fixture({ value, control: 'controllable_by_this_extension', storage: { useProxy },
        fetch: async () => response({ countryCode: 'PL' }),
      })
      const result = await state.load('service-request').requestService('https://service.example', () => true)
      assert.equal(result.viaProxy, true)
      assert.deepEqual(state.settings().value, value)
      assert.deepEqual(state.events, ['fetch'])
    })
  }
}

test('recheck inherited proxy after clearing disabled CT route', async () => {
  const state = fixture({ inherited: { mode: 'system' }, storage: { useProxy: false },
    fetch: async () => response({ countryCode: 'PL' }),
  })
  const result = await state.load('service-request').requestService('https://service.example', () => true)
  assert.equal(result.viaProxy, true)
  assert.deepEqual(state.events, ['clear', 'fetch'])
})

test('GeoIP is untrusted if proxy control changes during the request', async () => {
  const state = fixture({ fetch: async () => {
    for (const listener of state.routeListeners) listener({ levelOfControl: 'controlled_by_other_extensions' })
    return response({ countryCode: 'PL' })
  } })
  const result = await state.load('service-request').requestService('https://service.example', () => true)
  assert.equal(result.viaProxy, true)
  assert.equal(state.routeListeners.size, 0)
})

test('failed startup recovery is retried before the next proxy operation', async () => {
  const state = fixture()
  state.storage.serviceRouteSnapshot = { owned: true, value: state.original }
  const setting = state.browser.proxy.settings
  const originalSet = setting.set
  let attempts = 0
  setting.set = async args => {
    if (++attempts === 1) throw new Error('temporary failure')
    return originalSet(args)
  }
  const { withProxyLock } = state.load('proxy-route')
  await assert.rejects(withProxyLock(() => {}))
  await withProxyLock(() => assert.equal(state.storage.serviceRouteSnapshot, undefined))
  assert.equal(attempts, 2)
})

test('normal PAC update cannot re-enable proxy use during a disable action', async () => {
  const state = fixture({ mocks: {
    proxy: null, registry: { default: { getDomains: async () => ['example.com'] } },
  } })
  const setting = state.browser.proxy.settings
  const originalSet = setting.set
  setting.set = async args => {
    state.storage.useProxy = false
    return originalSet(args)
  }
  await state.load('proxy').default.setProxyInBackground()
  assert.equal(state.storage.useProxy, false)
  assert.equal(state.settings().value.mode, 'direct')
})

test('request permission cache is invalidated by control and user setting changes', async () => {
  const state = fixture()
  let reads = 0
  let control = 'controlled_by_this_extension'
  state.browser.proxy.settings.get = async () => { reads++; return { levelOfControl: control } }
  const { proxyRequestAllowed } = state.load('proxy-route')
  assert.equal(await proxyRequestAllowed(), true)
  assert.equal(await proxyRequestAllowed(), true)
  assert.equal(reads, 1)
  control = 'controlled_by_other_extensions'
  for (const listener of state.routeListeners) listener({ levelOfControl: control })
  assert.equal(await proxyRequestAllowed(), false)
  control = 'controlled_by_this_extension'
  state.storage.useProxy = false
  for (const listener of state.listeners) listener({ useProxy: { newValue: false } }, 'local')
  assert.equal(await proxyRequestAllowed(), false)
})

test('a transient permission read failure does not poison later authentication', async () => {
  const state = fixture()
  const original = state.browser.proxy.settings.get
  let reads = 0
  state.browser.proxy.settings.get = async () => {
    if (++reads === 1) throw new Error('temporary read failure')
    return original()
  }
  const { proxyRequestAllowed } = state.load('proxy-route')
  await assert.rejects(proxyRequestAllowed())
  assert.equal(await proxyRequestAllowed(), true)
})

test('a routing change during port knock cannot install the old proxy', async () => {
  const state = fixture({ storage: {
    customProxyProtocol: 'HTTPS', customProxyServerURI: 'old.example:443',
  }, mocks: {
    proxy: null, registry: { default: { getDomains: async () => ['example.com'] } },
  } })
  const proxy = state.load('proxy').default
  let knocks = 0
  proxy.ping = async () => {
    if (++knocks === 1) {
      state.storage.customProxyServerURI = 'new.example:443'
      for (const fn of state.listeners) fn({ customProxyServerURI: { newValue: 'new.example:443' } }, 'local')
    }
  }
  await proxy.setProxyInBackground()
  assert.equal(knocks, 2)
  assert.equal(state.events.filter(event => event === 'set').length, 1)
  assert.match(state.settings().value.pacScript.data, /new\.example/)
  assert.doesNotMatch(state.settings().value.pacScript.data, /old\.example/)
})

test('failed PAC application does not turn the user proxy setting off', async () => {
  const state = fixture({ mocks: {
    proxy: null, registry: { default: { getDomains: async () => ['example.com'] } },
  } })
  state.browser.proxy.settings.set = async () => { throw new Error('cannot apply') }
  assert.equal(await state.load('proxy').default.setProxyInBackground(), false)
  assert.equal(state.storage.useProxy, true)
  assert.equal(state.storage.proxyIsAlive, false)
})

test('an empty proxy pool installs a blocking route without disabling the extension', async () => {
  const state = fixture({ storage: { proxies: [], selectedProxyIds: [] }, mocks: {
    proxy: null, registry: { default: { getDomains: async () => [] } },
  } })
  assert.equal(await state.load('proxy').default.setProxyInBackground(), true)
  assert.equal(state.route('test.onion'), 'PROXY 127.0.0.1:0')
  assert.equal(state.route('other.example'), 'DIRECT')
  assert.equal(state.settings().value.pacScript.mandatory, true)
  assert.equal(state.storage.useProxy, true)
})

test('proxy-all reports failed application but preserves a disabled user preference', async () => {
  let actions
  const state = fixture({ mocks: {
    proxy: null, handlers: {}, server: {}, settings: { default: {} },
    'proxy-auth': { registerProxyAuth() {} },
    registry: { default: { getDomains: async () => [] } },
    'background-rpc': { registerBackground: value => { actions = value } },
  } })
  state.browser.proxy.settings.set = async () => { throw new Error('cannot apply') }
  state.load('background')
  await assert.rejects(actions.setProxyAll(true), /could not be applied/)
  assert.equal(state.storage.proxyAll, true)
  state.storage.useProxy = false
  await actions.setProxyAll(false)
  assert.equal(state.storage.proxyAll, false)
  await assert.rejects(actions.setProxyAll('true'), /Invalid/)
  assert.equal(state.storage.proxyAll, false)
})

test('reset explicitly enables proxy use before applying the PAC', async () => {
  const source = fs.readFileSync(path.join(root, '../pages/advanced-options.js'), 'utf8')
  const handler = source.slice(source.indexOf('confirmResetBtn.addEventListener'), source.indexOf('exportSettingsBtn.addEventListener'))
  let enabled = false
  let reset
  vm.runInNewContext(handler, {
    confirmResetBtn: { addEventListener: (name, fn) => { reset = fn } },
    togglePopup() {}, console: { info() {} },
    server: { synchronize: async () => {} },
    Settings: { enableExtension() {}, enableNotifications() {}, disableParentalControl() {} },
    ProxyManager: {
      removeBadProxies() {}, ping() {},
      enableProxy() { enabled = true },
      setProxy() { assert.equal(enabled, true) },
    },
  })
  await reset()
})

for (const code of ['RU', 'BY']) {
  test(`manual region ${code} clears mismatched cache before sync with proxy disabled`, async () => {
    const source = fs.readFileSync(path.join(root, '../pages/registry-options.js'), 'utf8')
    const handler = source.slice(source.indexOf('for (const option of options)'), source.lastIndexOf('})()'))
    const expected = code === 'RU' ? ['old.example'] : []
    const state = fixture({ storage: { useProxy: false, domains: ['old.example'], localConfig: { countryCode: 'RU' } },
      mocks: { 'service-request': { requestService: async () => {
        assert.deepEqual(state.storage.domains, expected)
        assert.equal(state.events[0], 'refresh')
        throw new Error('offline')
      } } },
    })
    let selectCountry
    vm.runInNewContext(handler, {
      options: [{ addEventListener: (event, fn) => { selectCountry = fn } }],
      select: { classList: { remove() {} } }, currentOption: { dataset: {} },
      browser: state.browser, console: { debug() {} },
      server: { synchronize: options => state.load('server').synchronizeInBackground({ ...options, syncProxy: false }) },
    })
    await selectCountry({ target: { dataset: { value: code }, textContent: code } })
    assert.equal(state.storage.currentRegionCode, code)
    assert.deepEqual(state.events, ['refresh', 'refresh'])
  })
}

test('disable during retry PAC installation prevents the proxy request', async () => {
  let calls = 0
  const state = fixture({ fetch: async () => { calls++; throw new Error('offline') } })
  const setting = state.browser.proxy.settings
  const originalSet = setting.set
  setting.set = async args => {
    await originalSet(args)
    if (state.events.includes('knock')) state.storage.useProxy = false
  }
  await assert.rejects(state.load('service-request').requestService('https://service.example', Array.isArray))
  assert.equal(calls, 1)
  assert.equal(state.storage.useProxy, false)
  assert.equal(state.storage.serviceRouteSnapshot, undefined)
})

test('disable aborts direct requests and releases temporary proxy routes', async () => {
  const state = fixture({ fetch: async (url, init, { storage, listeners }) => {
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('disabled')))
      storage.useProxy = false
      for (const listener of listeners) listener({ useProxy: { newValue: false } })
    })
  } })
  await assert.rejects(state.load('service-request').requestService('https://service.example', Array.isArray))
  assert.equal(state.storage.serviceRouteSnapshot, undefined)
  assert.ok(state.events.includes('clear'))
})

test('queued region selection cannot be overwritten by an old-country download', async () => {
  let release
  let started
  const fetching = new Promise(resolve => { started = resolve })
  const state = fixture({ storage: { currentRegionCode: 'RU', registryRegionCode: 'RU' },
    mocks: { 'service-request': { requestService: async url => {
      if (url.includes('ct-domains')) {
        started()
        await new Promise(resolve => { release = resolve })
        return { data: ['russian.example'] }
      }
      if (url.endsWith('by.json')) throw new Error('offline')
      return { data: [] }
    } } },
  })
  const { synchronizeInBackground } = state.load('server')
  const oldRequest = synchronizeInBackground({ syncProxy: false })
  await fetching
  const selection = synchronizeInBackground({ syncProxy: false, region: { countryCode: 'BY', countryName: 'Belarus' } })
  release()
  await Promise.all([oldRequest, selection])
  assert.equal(state.storage.currentRegionCode, 'BY')
  assert.equal(state.storage.registryRegionCode, 'BY')
  assert.deepEqual(state.storage.domains, [])
  assert.equal(state.events.at(-1), 'refresh')
})
