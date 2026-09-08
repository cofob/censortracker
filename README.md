<p align="center">
  <a href="https://censortracker.org/" target="_blank" rel="noreferrer noopener">
    <img width="250" alt="Censor Tracker's Quokka" src="https://censortracker.org/static/img/quokka_big.svg">
  </a>
</p>

<p align="center">
 <b>Censor Tracker</b> is a powerful <strong>censorship circumvention</strong> browser extension.<br>
</p>

<p align="center">In addition, it enables the use of custom proxies and supports <strong>Vless</strong>,
<strong>Vmess</strong>, and <strong>Shadowsocks</strong> in the browser via an external client called <a href="https://github.com/censortracker/proxy">Censor Tracker Proxy</a>.</p>

<p align="center">
  <a href="https://chrome.google.com/webstore/detail/censor-tracker/gaidoampbkcknofoejhnhbhbhhifgdop" target="_blank">
      <img src="https://img.shields.io/chrome-web-store/v/gaidoampbkcknofoejhnhbhbhhifgdop" alt="Test">
  </a>
  <a href="https://addons.mozilla.org/ru/firefox/addon/censor-tracker/" target="_blank">
      <img src="https://img.shields.io/amo/v/censor-tracker" alt="Test">
  </a>
</p>


Features
========

Censor Tracker offers a range of useful features, including:

- Built-in and custom HTTP, HTTPS, SOCKS4 and SOCKS5 proxies, with site distribution and failover
- HTTP/HTTPS proxy authentication in both browsers; SOCKS5 authentication in Firefox
- Regional blocked-site registries and optional external hostname lists, including Anticensority
- Full hostname and subdomain rules, international domain names, and exclusion lists
- Proxy imports from text, files, URLs and PAC files; optional subscriptions and Antizapret imports
- Parallel proxy checks with delay, exit IP and country results; filtering, sorting and bulk deletion
- Optional proxy-all mode and site exit-country restrictions in Advanced options
- Popup details for the planned route and last checked exit; selection of related page domains to proxy
- Validated settings backups, including imports from legacy Censor Tracker and avatarDD fork backups
- Warnings for websites in the information-disseminator registry
- Support  `Vless`, `Vmess` and `Shadowsocks` proxies ([Censor Tracker Proxy](https://github.com/censortracker/proxy) is
  required)

Permissions
===========

Censor Tracker requires the following permissions:

- `alarms` — Enables periodic tasks such as database synchronization and re-requesting the list of proxy servers.
- `activeTab` — Allows inspection of the current page when the user requests related domains.
- `management` — Identifies permission conflicts (e.g., with other extensions).
- `notifications` — Displays notifications.
- `proxy` — Configures built-in and custom proxy routes.
- `storage` — Saves user preferences.
- `unlimitedStorage` — Stores the database of blocked websites (due to its large size).
- `tabs` (Firefox) — Reads tab URLs and supports page inspection.
- `scripting` (Chromium) — Reads resource hostnames from the current page on request.
- `webNavigation` (Chromium) — Monitors navigation and proxy connection errors.
- `webRequest` — Handles request events and proxy authentication.
- `webRequestAuthProvider` (Chromium) and `webRequestBlocking` (Firefox) — Supply proxy credentials.
- `<all_urls>` — Allows website proxying, service downloads, country detection and page inspection.

Requirements
============

The manifests specify these minimum browser versions:

- Mozilla Firefox 91.1.0 or higher
- Chromium (Google Chrome, Brave, Edge, Opera etc.) 108 or higher

Development
===========

Use Node.js 24.15.0 or higher and the npm version included with it.

Optionally, you may like:

- [`nvm`](https://github.com/nvm-sh/nvm)

Install dependencies from the repository root:

    npm ci

Build commands and output directories:

    npm run build:chrome        # dist/chrome/dev/
    npm run build:firefox       # dist/firefox/dev/
    npm run build:chrome:prod   # dist/chrome/prod/
    npm run build:firefox:prod  # dist/firefox/prod/

Run tests and all lint checks from the repository root:

    npm test
    npm run lint
    npm run stylelint
    npm run locales:check

For browser tests, build the production bundles, then run `npm run test:browser`. The tests need `chromium`,
`firefox` and `openssl` on `PATH`; use `CHROMIUM` and `FIREFOX` to specify other browser executable paths.
To test the Chrome development bundle, build it and set `CT_BROWSER_BUILD=dev`.

The Build workflow runs on each push and uploads the Chrome and Firefox production folders as artifacts.

**Troubleshooting**: If you're getting error on building an extension using `npm`, please make sure that your
shell supports per-command environment variables (i.e something like this
`NODE_ENV=production npm run build:firefox:prod`)

License
=======

Censor Tracker is licensed under the MIT License. See [LICENSE] for more
information.

[LICENSE]: https://github.com/censortracker/censortracker/blob/master/LICENSE
