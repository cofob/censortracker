import browser from 'Background/browser-api'

import { mountKeySequence } from './key-sequence'

mountKeySequence(() => browser.tabs.create({
  url: browser.runtime.getURL('animation.html'),
}))
