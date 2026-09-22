# Unreleased

- Ported Amnezia Premium local proxy support with dynamic ports, connection checks, recovery and updated settings.

- Added a shared list for built-in and custom proxies, site distribution, failover and proxy authentication.
- Added proxy imports, optional subscriptions, parallel checks, filtering, sorting and bulk deletion.
- Added optional proxy-all mode and site exit-country restrictions; local addresses and exclusions stay direct.
- Added external registries, Anticensority hostname lists and Antizapret proxies limited to provider-listed domains.
- Added planned route details, last checked exit information and related page domain selection to the popup.
- Added validated settings imports and exports, including legacy and avatarDD fork backups.
- Fixed hostname matching, proxy endpoint validation, stale routing updates and recovery of failed proxies.
- Replaced remote service configuration with built-in endpoints and direct requests with proxy fallback.
- Fixed port knocks to use a temporary direct route, including in proxy-all mode.
- Updated dependencies and the domain editor; added tests, current lint tools and CI build artifacts.

# 15.0.0

- Added support for importing proxy lists from a file or URL
- Fixed styles for dark theme
- Fixed a bug that caused tabs to reload


# 12.0.0

- Fix locale issues
- Refactor PAC file generator
- Add support for '*.onion' and '*.i2p' domains
- Add notification about update availability

# 10.2.0

- Fixed updating issue.

# 10.1.0

- Fixed ignore list saving issues

# 10.0.0

- Censor Tracker now knows how to automatically re-request proxy servers if there are problems with the availability of the proxy server used.
- Made server services more fault-tolerant.
- Fixed inaccuracies and bugs in UI.
- Updating of proxying/ignoring list was made more obvious: now you have to click on corresponding button to save changes.
- Added support for Kyrgyzstan and Uzbekistan.
- Fixed incorrect display of status (icons) on some sites.
- Made debugging information more detailed, so we can help you when problems.
- Fixed inaccuracies in English and Russian versions of the extension.
- Improved overall performance of the extension and reduced the size of the extension (-300kb).
- Fixed other bugs (see GitHub repository for details)

# 8.5.0

- Improved performance of `popup` and `options`
- Added support of website actions in `popup`
- Fixed debug info page for `Firefox` and `Chrome`
- Fixed proxying/ignoring conflicts
- Fixed bug which caused that some requests were not proxied (proxying was not working for `subdomain.domain.com`, but for `domain.com`)
- Fixed typos and grammar in locales
- Removed unused functionality

# 7.0.0
- Added donate button
- Improved performance of pages
- Added support of emergency endpoints
- Added support of regions
- Improved performance of tabs
- Redesigned `Options` page
- Fixed typos in locales
- Added option to choice region based on which will be used specific database of blocked websites.
- Reworked `Advanced options` to make it easy to see debug information.
- Fixed [#409](https://github.com/roskomsvoboda/censortracker/issues/409).
- Fixed [#410](https://github.com/roskomsvoboda/censortracker/issues/410).

# 6.1.0.0
- Fixed bugs
- Improved performance

# 6.0.0.0

- Fix performance issues and bugs
- Migrated to Manifest v3 for Chromium version.
- Added ``chrome.alarms`` and ``browser.alarms`` support.
- Fixed config caching issues.
- Added `Parental Control` feature.
- Fixed [#382](https://github.com/roskomsvoboda/censortracker/issues/382).

### 5.3.1.0

- Fixed duplication in ignore

### 5.3.0.0

- Fixed bugs
- Improved performance
- Add global ignore support

### 5.2.0.0

- Fixed config fetching mechanism
- Improve `onInstall` handler

### 5.1.0.0

- Fixed status icon to make it clear when proxy is enabled/disabled
- Fixed spontaneous activation of proxying on browser start up
- Prevent default dialog window on saving ignored/proxied websites
- Refactor some modules
