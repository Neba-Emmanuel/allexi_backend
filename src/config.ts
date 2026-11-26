export type RuntimeConfig = {
  port: number;
  production: boolean;
  url?: string;
  key?: string;
  serviceKey?: string;
  origins: string[];
  trustProxy: number;
};
export function readConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 3001);
  const trustProxy = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5)
    throw new Error("TRUST_PROXY_HOPS must be between 0 and 5");
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const origins = (
    env.CORS_ORIGINS ?? (production ? "" : "http://localhost:8081")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!!url !== !!key)
    throw new Error("Configure both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
  if (production && (!url || !key || !serviceKey))
    throw new Error(
      "Production requires Supabase URL, publishable key and server-only service role key for account deletion",
    );
  if (
    url &&
    (!validUrl(url, production) || /your-project|example\./i.test(url))
  )
    throw new Error(
      "SUPABASE_URL must be a real project URL (HTTPS in production)",
    );
  if (
    key &&
    (key.startsWith("sb_secret_") ||
      jwtRole(key) === "service_role" ||
      /your-publishable|fixture-key/.test(key))
  )
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY must be a public publishable or anon key",
    );
  for (const origin of origins) {
    if (!validUrl(origin, production) || new URL(origin).origin !== origin)
      throw new Error(
        "CORS_ORIGINS must list exact origins (HTTPS in production), without paths or wildcards",
      );
  }
  return { production, port, trustProxy, url, key, serviceKey, origins };
}
function validUrl(value: string, https: boolean) {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (https
        ? url.protocol === "https:"
        : ["http:", "https:"].includes(url.protocol))
    );
  } catch {
    return false;
  }
}
function jwtRole(key: string) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
      .role;
  } catch {
    return undefined;
  }
}
