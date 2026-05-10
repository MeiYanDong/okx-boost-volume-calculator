import { applySecurityHeaders, createProxyConfig, handleRpcProxy, sendProxyError } from "../server/proxy.mjs";

const config = createProxyConfig(process.env);

export default async function handler(request, response) {
  try {
    applySecurityHeaders(response, true);
    await handleRpcProxy(request, response, config, process.env);
  } catch (error) {
    sendProxyError(response, error, config);
  }
}
