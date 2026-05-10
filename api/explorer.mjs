import { applySecurityHeaders, createProxyConfig, handleExplorerProxy, sendProxyError } from "../server/proxy.mjs";

const config = createProxyConfig(process.env);

export default async function handler(request, response) {
  try {
    applySecurityHeaders(response, true);
    await handleExplorerProxy(request, response, config, undefined, process.env);
  } catch (error) {
    sendProxyError(response, error, config);
  }
}
