"use client";
// Browser auth client (publishable key, cookie session). Lazy singleton: nothing runs at import time.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPublishableKey } from "./supabase-key";

let client: SupabaseClient | undefined;

export function createBrowserAuthClient(): SupabaseClient {
  if (client) return client;
  // Literal property access so Next inlines the NEXT_PUBLIC_* values into the bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
  }
  assertPublishableKey(key);
  client = createBrowserClient(url, key);
  return client;
}
