/**
 * Supabase client for the mobile app.
 * All operations target the 'ninja' schema.
 *
 * PostgREST v9 on the self-hosted instance requires explicit
 * Accept-Profile/Content-Profile headers for schema selection.
 * We inject these via a custom fetch wrapper.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const SCHEMA = "ninja";

/**
 * Custom fetch that injects ninja schema headers for PostgREST v9 compatibility.
 */
const schemaFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);

  // Only add schema headers for PostgREST REST API calls
  const url = typeof input === "string" ? input : (input as Request).url;
  if (url.includes("/rest/v1/")) {
    if (!headers.has("Accept-Profile")) {
      headers.set("Accept-Profile", SCHEMA);
    }
    if (!headers.has("Content-Profile")) {
      headers.set("Content-Profile", SCHEMA);
    }
  }

  return fetch(input, { ...init, headers });
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  db: { schema: SCHEMA },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On web, detect tokens in the URL after OAuth redirect
    detectSessionInUrl: Platform.OS === "web",
  },
  global: {
    fetch: schemaFetch,
  },
});

/**
 * Invoke a Supabase Edge Function.
 * On non-2xx, tries to surface the response body (e.g. { error: "..." }) so the app can show it instead of the generic "Edge Function returned a non-2xx status code".
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, {
    body,
  });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: { json?: () => Promise<unknown> } })
      ?.context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = (await ctx.json()) as { error?: string; message?: string };
        if (body?.error || body?.message) {
          message = body.error ?? body.message ?? message;
        }
      } catch {
        // ignore parse failure, use default message
      }
    }
    throw new Error(message);
  }
  return data as T;
}
