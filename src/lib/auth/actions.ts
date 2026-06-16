"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  redirectTo: z.string().optional(),
});

export interface SignInResult {
  ok: boolean;
  message: string;
}

/**
 * Send a magic link to the given email. Once clicked, the link returns to
 * `/auth/callback` which finalises the session and redirects to `/app/dashboard`.
 */
export async function signInWithEmail(formData: FormData): Promise<SignInResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const next = parsed.data.redirectTo ?? "/app/dashboard";

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true, message: `Magic link sent to ${parsed.data.email}. Check your inbox.` };
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
