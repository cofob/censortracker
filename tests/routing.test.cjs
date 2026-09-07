const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const load = require('./load.cjs')
const { getPacScript } = load('background/pac')
const { createRouter, routingConfig } = load('background/routing')
const { findHostMatch } = load('background/host-match')
const { isPrivateHost } = load('background/private-host')

test('sites have stable first proxies and all selected failover candidates', () => {
  const options = { domains: ['example.com'], proxies: [
    { id: 'one', protocol: 'HTTP', host: 'one.example', port: 80 },
    { id: 'two', protocol: 'HTTPS', host: 'two.example', port: 443 },
    { id: 'three', protocol: 'SOCKS5', host: 'three.example', port: 1080 },
  ] }
  const router = createRouter(routingConfig(options), findHostMatch, isPrivateHost)
  const context = {}
  vm.runInNewContext(getPacScript(options), context)
  const first = new Set()
  for (let index = 0; index < 100; index++) {
    const host = `site${index}.example.com`
    const result = router(host)
    first.add(result.proxies[0])
    assert.equal(result.type, 'proxy')
    assert.equal(new Set(result.proxies).size, 3)
    assert.equal(context.FindProxyForURL('', host.toUpperCase() + '.'), result.route)
    assert.doesNotMatch(result.route, /DIRECT/)
  }
  assert.equal(first.size, 3)
  assert.equal(router('other.example').type, 'direct')
})

test('no selected endpoint blocks protected destinations, including onion with an empty registry', () => {
  const context = {}
  vm.runInNewContext(getPacScript({ domains: ['example.com'], ignoredHosts: ['api.example.com'] }), context)
  for (const host of ['example.com', 'a.example.com', 'test.onion', 'test.i2p']) {
    assert.equal(context.FindProxyForURL('', host), 'PROXY 127.0.0.1:0')
  }
  for (const host of ['api.example.com', 'router', '10.0.0.1', 'other.example']) {
    assert.equal(context.FindProxyForURL('', host), 'DIRECT')
  }
})

test('proxy-all preserves local and explicit exclusions and blocks without a proxy', () => {
  for (const proxies of [[], [{ id: 'one', protocol: 'HTTPS', host: 'one.example', port: 443 }]]) {
    const context = {}
    vm.runInNewContext(getPacScript({ proxyAll: true, ignoredHosts: ['excluded.example'], proxies }), context)
    for (const host of ['public.example', 'other.co.uk', '8.8.8.8']) {
      assert.equal(context.FindProxyForURL('', host), proxies.length ? 'HTTPS one.example:443;' : 'PROXY 127.0.0.1:0')
    }
    for (const host of ['excluded.example', 'cdn.excluded.example', 'router', 'printer.local', '192.168.1.1', '100.64.0.1', '224.1.2.3', '[fd00::1]']) {
      assert.equal(context.FindProxyForURL('', host), 'DIRECT', host)
    }
  }
})
