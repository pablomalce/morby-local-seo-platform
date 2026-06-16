import type { Metadata } from "next";
import { LegalHeader, LegalList, LegalNote, LegalSection } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Vulkan Growth OS",
  description: "How Vulkan Studios collects, uses and protects your personal data under GDPR.",
};

export default function PrivacyPolicyPage() {
  return (
    <article>
      <LegalHeader
        eyebrow="LEGAL · PRIVACY"
        title="Privacy Policy"
        effective="June 2026"
      />

      <LegalNote>
        This policy describes how Vulkan Studios processes personal data when you use Vulkan
        Growth OS. We follow the EU General Data Protection Regulation (GDPR) and the Swedish
        Data Protection Act. If you have questions, write to{" "}
        <a className="text-vulkan-orange underline" href="mailto:privacy@vulkan-studios.com">
          privacy@vulkan-studios.com
        </a>
        .
      </LegalNote>

      <LegalSection number="01" title="Who we are">
        <p>
          Vulkan Studios is the data controller for the personal data processed through Vulkan
          Growth OS (the "Platform"). For any data-related question, contact{" "}
          <a className="text-vulkan-orange underline" href="mailto:privacy@vulkan-studios.com">
            privacy@vulkan-studios.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection number="02" title="What data we collect">
        <p>We process the minimum data required to deliver the Platform:</p>
        <LegalList
          items={[
            <span>
              <strong className="text-vulkan-white">Account data</strong> — email address
              (collected via Supabase Auth magic links).
            </span>,
            <span>
              <strong className="text-vulkan-white">Tenant data</strong> — businesses,
              locations and services you create about your clients. You decide what to enter.
            </span>,
            <span>
              <strong className="text-vulkan-white">Generated artefacts</strong> — content
              drafts, competitor entries, reviews and reports created by agents.
            </span>,
            <span>
              <strong className="text-vulkan-white">Technical data</strong> — IP address,
              user-agent and timing data captured by our hosting provider (Vercel) for security
              and performance.
            </span>,
            <span>
              <strong className="text-vulkan-white">Preference data</strong> — language,
              selected tenant and consent choices, stored in your browser via{" "}
              <code className="font-mono text-[12px] text-vulkan-orange">localStorage</code>.
            </span>,
          ]}
        />
      </LegalSection>

      <LegalSection number="03" title="Lawful basis">
        <p>We process personal data on the following legal grounds (GDPR Article 6):</p>
        <LegalList
          items={[
            <span>
              <strong className="text-vulkan-white">Contract performance</strong> — to
              provide you the Platform you signed up for (account, dashboards, agents).
            </span>,
            <span>
              <strong className="text-vulkan-white">Legitimate interest</strong> — to keep
              the service secure, prevent abuse and improve features. We only rely on this
              when our interest doesn't override your rights.
            </span>,
            <span>
              <strong className="text-vulkan-white">Consent</strong> — for optional cookies
              (functional, analytics, marketing). You can withdraw consent at any time from
              the footer.
            </span>,
            <span>
              <strong className="text-vulkan-white">Legal obligation</strong> — when we must
              comply with applicable law.
            </span>,
          ]}
        />
      </LegalSection>

      <LegalSection number="04" title="Where your data lives">
        <p>
          Vulkan Growth OS runs on Vercel (hosting, edge functions) and Supabase (Postgres
          database, authentication, storage). Both providers are GDPR-compliant and process
          data in the EU. Supabase data for your project is stored in{" "}
          <strong className="text-vulkan-white">eu-north-1 (Stockholm, Sweden)</strong>.
        </p>
        <p>
          We do not sell your data. We do not share it with third parties for marketing.
        </p>
      </LegalSection>

      <LegalSection number="05" title="Your rights">
        <p>Under GDPR you have the right to:</p>
        <LegalList
          items={[
            "Access your data — request a copy of everything we hold about you.",
            "Rectify inaccurate data — correct anything wrong.",
            "Erase your data — close your account and delete everything we hold (right to be forgotten).",
            "Restrict processing — pause specific uses.",
            "Object to processing based on legitimate interest.",
            "Data portability — receive your data in a machine-readable JSON format.",
            "Withdraw consent at any time for cookies or any consent-based processing.",
            "Lodge a complaint with your data protection authority (in Sweden: IMY).",
          ]}
        />
        <p>
          You can exercise the access, deletion and portability rights from your account
          settings page. For anything else, email{" "}
          <a className="text-vulkan-orange underline" href="mailto:privacy@vulkan-studios.com">
            privacy@vulkan-studios.com
          </a>
          . We respond within 30 days.
        </p>
      </LegalSection>

      <LegalSection number="06" title="Retention">
        <p>
          We keep your account and tenant data for as long as your account is active. When
          you delete your account, all your tenant data, content, competitor entries, reviews,
          reports and agent runs are permanently removed within 30 days. Backups containing
          your data are rotated within 30 days.
        </p>
      </LegalSection>

      <LegalSection number="07" title="Security">
        <p>
          We use industry-standard protections: TLS in transit, encryption at rest via
          Supabase, row-level security enforcing tenant isolation, magic-link authentication
          (no passwords stored), and server-side handling of all secrets. If a breach affects
          your data, we'll notify you and the relevant supervisory authority within 72 hours.
        </p>
      </LegalSection>

      <LegalSection number="08" title="Changes">
        <p>
          We may update this policy. When we make material changes we'll notify you by email
          and update the "Effective" date above. Continued use after a change means you
          accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection number="09" title="Contact">
        <p>
          Data controller: Vulkan Studios.
          <br />
          Privacy contact:{" "}
          <a className="text-vulkan-orange underline" href="mailto:privacy@vulkan-studios.com">
            privacy@vulkan-studios.com
          </a>
          <br />
          Swedish Authority for Privacy Protection (IMY):{" "}
          <a className="text-vulkan-orange underline" href="https://imy.se" target="_blank" rel="noreferrer">
            imy.se
          </a>
        </p>
      </LegalSection>
    </article>
  );
}
