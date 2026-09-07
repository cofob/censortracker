import { countryCode } from 'Background/proxy-check-data'

export const checkedCountry = (check, field) =>
  (check?.status === 'ok' && countryCode(check[field])) || '?'

export const filterProxies = (proxies, checks, options) => {
  const result = proxies.filter(({ id }) =>
    ['serverCountry', 'exitCountry'].every((field) =>
      !options[field] || checkedCountry(checks[id], field) === options[field]))

  if (options.sort === 'name') {
    result.sort((first, second) => first.name.localeCompare(second.name))
  } else if (options.sort === 'latency') {
    const latency = ({ id }) => checks[id]?.status === 'ok' &&
      Number.isFinite(checks[id].latency) ? checks[id].latency : Infinity

    result.sort((first, second) => latency(first) - latency(second))
  } else if (['serverCountry', 'exitCountry'].includes(options.sort)) {
    const country = ({ id }) => checkedCountry(checks[id], options.sort)
      .replace('?', 'ZZZ')

    result.sort((first, second) =>
      country(first).localeCompare(country(second)))
  }
  return result
}
