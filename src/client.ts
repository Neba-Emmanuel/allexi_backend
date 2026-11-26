import { createClient } from "@supabase/supabase-js";
// Bound every dependency call, including Auth, so failed upstreams cannot exhaust requests.
export const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
export function databaseClient(url: string, key: string, token?: string) {
  return createClient(url, key, {
    global: {
      fetch: boundedFetch,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
