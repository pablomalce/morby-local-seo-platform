import type { Metadata } from "next";
import { LegalHeader, LegalNote, LegalSection } from "@/components/legal";

export const metadata: Metadata = {
  title: "Cookie Policy — Vulkan Growth OS",
  description: "Which cookies and local storage Vulkan Growth OS uses, and why.",
};

const cookieTable = [
  {
    name: "sb-* (Supabase Auth)",
    category: "Strictly necessary",
    purpose: "Maintains your sign-in session. HTTP-only, secure, SameSite=Lax.",
    expires: "1 hour (access) / 30 days (refresh)",
  },
  {
    name: "lg.cookie-consent.v1",
    category: "Strictly necessary",
    purpose: "Stores your consent choices so we don't ask on every page.",
    expires: "12 months · localStorage",
  },
  {
    name: "lg.locale",
    category: "Functional",
    purpose: "Remembers your selected interface language (EN / ES / SV).",
    expires: "Until cleared · localStorage",
  },
  {
    name: "lg.selection",
    category: "Functional",
    purpose: "Remembers the business / service / location you last selected.",
    expires: "Until cleared · localStorage",
  },
  {
    name: "lg.tenants.v2",
    category: "Functional",
    purpose:
      "When you use the public demo (no account), stores tenants you create so they persist across reloads.",
    expires: "Until cleared · localStorage",
  },
];

export default function CookiePolicyPage() {
  return (
    <article>
      <LegalHeader eyebrow="LEGAL · COOKIES" title="Cookie Policy" effective="June 2026" />

      <LegalNote>
        We only set cookies and local storage entries that are strictly necessary by default.
        Everything else requires your explicit consent (RGPD / ePrivacy Directive Article 5(3)).
        You can change your choice anytime from the "Cookie preferences" link in the footer.
      </LegalNote>

      <LegalSection number="01" title="What is a cookie?">
        <p>
          A cookie is a small text file a website stores on your browser. Beyond classic cookies,
          some browsers also offer localStorage and IndexedDB — the same logic applies under
          GDPR and ePrivacy: anything that isn't strictly necessary needs your consent.
        </p>
      </LegalSection>

      <LegalSection number="02" title="The categories we use">
        <p>
          <strong className="text-vulkan-white">Strictly necessary</strong> — required for the
          Platform to function. Cannot be refused (you'd not be able to sign in or save your
          consent choice).
        </p>
        <p>
          <strong className="text-vulkan-white">Functional</strong> — quality-of-life: remember
          your language, the last business you opened, the last service you focused on. We
          recommend you accept these but the Platform works without them.
        </p>
        <p>
          <strong className="text-vulkan-white">Analytics</strong> — anonymous, aggregated usage
          data we use to improve the Platform. Off by default.
        </p>
        <p>
          <strong className="text-vulkan-white">Marketing</strong> — currently unused. The
          category exists so you can opt out preemptively; we will not enable any marketing
          tracker without re-asking for explicit consent.
        </p>
      </LegalSection>

      <LegalSection number="03" title="What we store, specifically">
        <div className="overflow-x-auto rounded-vulkan border border-metal-800">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-metal-950">
              <tr>
                <th className="px-3 py-2 font-mono uppercase tracking-hud text-metal-400">Name</th>
                <th className="px-3 py-2 font-mono uppercase tracking-hud text-metal-400">Category</th>
                <th className="px-3 py-2 font-mono uppercase tracking-hud text-metal-400">Purpose</th>
                <th className="px-3 py-2 font-mono uppercase tracking-hud text-metal-400">Expires</th>
              </tr>
            </thead>
            <tbody>
              {cookieTable.map((c) => (
                <tr key={c.name} className="border-t border-metal-800">
                  <td className="px-3 py-2 font-mono text-[11px] text-vulkan-orange">{c.name}</td>
                  <td className="px-3 py-2 text-metal-300">{c.category}</td>
                  <td className="px-3 py-2 text-metal-300">{c.purpose}</td>
                  <td className="px-3 py-2 text-metal-400">{c.expires}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection number="04" title="Third parties">
        <p>
          <strong className="text-vulkan-white">Supabase</strong> — sets HTTP-only auth cookies
          when you sign in. These never leave the browser-server boundary and are required for
          the session to work.
        </p>
        <p>
          <strong className="text-vulkan-white">Vercel</strong> — sets minimal first-party
          cookies for routing and security (e.g. JWT verification on edge). No tracking.
        </p>
        <p>
          <strong className="text-vulkan-white">Google Fonts</strong> — the only third-party
          domain we load assets from (fonts.googleapis.com / fonts.gstatic.com). Self-hosting is
          on the roadmap.
        </p>
      </LegalSection>

      <LegalSection number="05" title="Changing your mind">
        <p>
          Click "Cookie preferences" in the footer to reopen the banner. Withdrawing consent
          takes effect immediately for future requests; data already processed under your
          previous consent will be retained according to our{" "}
          <a className="text-vulkan-orange underline" href="/legal/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection number="06" title="Contact">
        <p>
          Questions about cookies?{" "}
          <a className="text-vulkan-orange underline" href="mailto:privacy@vulkan-studios.com">
            privacy@vulkan-studios.com
          </a>
        </p>
      </LegalSection>
    </article>
  );
}
