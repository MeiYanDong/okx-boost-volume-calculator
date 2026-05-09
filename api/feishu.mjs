import { applySecurityHeaders, createProxyConfig, handleFeishuNotify, sendProxyError } from "../server/proxy.mjs";

const config = createProxyConfig(process.env);

export default async function handler(request, response) {
  try {
    applySecurityHeaders(response, true);
    await handleFeishuNotify(request, response, config);
  } catch (error) {
    sendProxyError(response, error, config);
  }
}
