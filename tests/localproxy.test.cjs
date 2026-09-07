const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

test('local proxy configuration IDs stay inside one API query parameter', async () => {
  const client = load('background/localproxy', { 'browser-api': { default: {} } }).default
  const id = 'config &uuid=other#fragment'
  const requests = []
  client.request = async (method, endpoint) => { requests.push(endpoint); return {} }
  await client.getConfig(id)
  await client.deleteConfig(id)
  await client.activateConfig(id)
  for (const endpoint of requests) {
    const params = new URL(endpoint, 'http://localhost').searchParams
    assert.deepEqual(Array.from(params), [['uuid', id]])
  }
})

test('local proxy mode and endpoint change in one storage write', async () => {
  const writes = []
  const browser = { storage: { local: {
    set: async values => writes.push(JSON.parse(JSON.stringify(values))),
    remove: async keys => writes.push({ removed: keys }),
  } } }
  const mocks = { 'browser-api': { default: browser }, 'proxy-route': {}, registry: { default: {} } }
  const client = load('background/localproxy', mocks).default
  const manager = load('background/proxy', mocks).default
  await client.setLocalProxyURI()
  await manager.removeLocalProxy()
  assert.deepEqual(writes, [
    { useLocalProxy: true, localProxyURI: '127.0.0.1:10808' },
    { useLocalProxy: false, localProxyURI: null },
  ])
})
