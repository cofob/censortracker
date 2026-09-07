const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')
const vm = require('node:vm')
const { normalizeHostname } = load('background/hostname')

test('international names use the same canonical ASCII form as browser requests', () => {
  assert.equal(normalizeHostname('https://ПРИМЕР.РФ./path'), 'xn--e1afmkfd.xn--p1ai')
  assert.equal(normalizeHostname('BÜCHER.de'), 'xn--bcher-kva.de')
  assert.equal(normalizeHostname('xn--bcher-kva.de'), 'xn--bcher-kva.de')
  assert.equal(normalizeHostname('https://a.b.example.co.uk:443'), 'a.b.example.co.uk')
  assert.equal(normalizeHostname('http://[2001:0db8::1]:80'), '[2001:db8::1]')
  for (const input of [null, 42, '', 'about:blank', 'moz-extension://id/x',
    '-invalid.com', 'x..com', 'a\nb.com', 'x'.repeat(64) + '.com']) {
    assert.equal(normalizeHostname(input), null, String(input))
  }
})

test('Unicode settings and proxy addresses produce an ASCII PAC route', () => {
  const { getPacScript } = load('background/pac')
  const domains = ['пример.рф', null]
  const context = { shExpMatch: () => false }
  vm.runInNewContext(getPacScript({ domains,
    proxyServerProtocol: 'HTTPS', proxyServerURI: 'ПРОКСИ.РФ:443' }), context)
  assert.equal(context.FindProxyForURL('', 'xn--e1afmkfd.xn--p1ai'), 'HTTPS xn--h1adldfi.xn--p1ai:443;')
  assert.equal(context.FindProxyForURL('', 'XN--E1AFMKFD.XN--P1AI.'), 'HTTPS xn--h1adldfi.xn--p1ai:443;')
  assert.deepEqual(domains, ['пример.рф', null])
})

test('UI helpers normalize IDNs and reject malformed extension links', () => {
  const helpers = load('background/utilities', { 'browser-api': { default: {} } })
  assert.equal(helpers.extractDomainFromUrl('https://www.ПРИМЕР.РФ'), 'xn--e1afmkfd.xn--p1ai')
  assert.equal(helpers.extractHostnameFromUrl('https://www.ПРИМЕР.РФ'), 'www.xn--e1afmkfd.xn--p1ai')
  assert.deepEqual(Array.from(helpers.removeDuplicates([' ПРИМЕР.РФ ', 'xn--e1afmkfd.xn--p1ai'])), ['xn--e1afmkfd.xn--p1ai'])
  assert.equal(helpers.extractDomainFromUrl('moz-extension://id/options?loadFor=%'), null)
  assert.equal(helpers.extractDomainFromUrl(undefined), null)
})
