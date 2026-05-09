import { applySecurityHeaders, createProxyConfig, sendProxyError } from "../server/proxy.mjs";
import { handleArchiveApi } from "../server/archiveApi.mjs";

const config = createProxyConfig(process.env);

export default async function handler(request, response) {
  try {
    applySecurityHeaders(response, true);
    await handleArchiveApi(request, response, config, process.env);
  } catch (error) {
    sendProxyError(response, error, config);
  }
}
