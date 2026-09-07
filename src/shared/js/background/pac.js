import { findHostMatch } from './host-match'
import { isPrivateHost } from './private-host'
import { createRouter, routingConfig } from './routing'

export const getPacScript = (options) => `
    var ctRoute = (${createRouter.toString()})(
      ${JSON.stringify(routingConfig(options))},
      ${findHostMatch.toString()}, ${isPrivateHost.toString()}
    );
    function FindProxyForURL(url, host) {
      return ctRoute(host).route;
    }`
