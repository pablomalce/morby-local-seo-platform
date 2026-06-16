import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Admin client — uses the service role key to bypass RLS.
 *
 * SERVER-ONLY. Never import this from any Client Component, page that runs in the browser, or
 * shared module that could end up in the client bundle. Use it from Route Handlers or Server
 * Actions for trusted operations: provisioning, background jobs, admin tooling.
 */
export function createSupabaseAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createSupabaseAdminClient must only be called on the server.");
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
