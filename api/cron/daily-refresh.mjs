import { handleDailyRefreshCron } from "../../server/cronApi.mjs";
import { applySecurityHeaders, createProxyConfig, sendProxyError } from "../../server/proxy.mjs";

const config = createProxyConfig(process.env);

export default async function handler(request, response) {
  try {
    applySecurityHeaders(response, true);
    await handleDailyRefreshCron(request, response, config, process.env);
  } catch (error) {
    sendProxyError(response, error, config);
  }
}
