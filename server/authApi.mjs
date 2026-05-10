import { createInvite, getSupabaseUserFromRequest, isSupabaseConfigured, redeemInvite, refreshAuthSession, signInWithPassword } from "./supabaseStore.mjs";
import { readJsonBody, requestUrl, sendJson, validateAccess } from "./proxy.mjs";

export async function handleAuthApi(request, response, config, env = process.env) {
  const url = requestUrl(request);

  if (request.method === "GET") {
    if (url.searchParams.get("action") !== "me") {
      sendJson(response, 405, { error: "Use POST or GET?action=me" }, { "cache-control": "no-store" });
      return;
    }
    const auth = await getSupabaseUserFromRequest(request, env);
    sendJson(
      response,
      200,
      {
        configured: isSupabaseConfigured(env),
        user: auth?.user
          ? {
              id: auth.user.id,
              email: auth.user.email || "",
            }
          : null,
      },
      { "cache-control": "no-store" },
    );
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST" }, { "cache-control": "no-store" });
    return;
  }

  const body = await readJsonBody(request);
  const action = String(body?.action || "").trim();

  if (action === "sign-in") {
    const session = await signInWithPassword(body, env);
    sendJson(response, 200, { ok: true, session }, { "cache-control": "no-store" });
    return;
  }

  if (action === "refresh") {
    const session = await refreshAuthSession(body?.refreshToken, env);
    sendJson(response, 200, { ok: true, session }, { "cache-control": "no-store" });
    return;
  }

  if (action === "redeem") {
    const result = await redeemInvite(body, env);
    sendJson(response, 200, { ok: true, ...result }, { "cache-control": "no-store" });
    return;
  }

  if (action === "create-invite") {
    validateAccess(request, config);
    const result = await createInvite(body, env);
    sendJson(response, 200, { ok: true, ...result }, { "cache-control": "no-store" });
    return;
  }

  sendJson(response, 400, { error: "Unknown auth action" }, { "cache-control": "no-store" });
}
