import type { Metadata } from "next";
import { LegalHeader, LegalList, LegalNote, LegalSection } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of Service — Vulkan Growth OS",
  description: "The terms that govern your use of Vulkan Growth OS.",
};

export default function TermsPage() {
  return (
    <article>
      <LegalHeader eyebrow="LEGAL · TERMS" title="Terms of Service" effective="June 2026" />

      <LegalNote>
        These terms govern your use of Vulkan Growth OS (the "Platform"), operated by Vulkan
        Studios. By creating an account or using the public demo, you accept them. If you don't
        agree, please don't use the Platform.
      </LegalNote>

      <LegalSection number="01" title="The Platform">
        <p>
          Vulkan Growth OS is a multi-tenant SaaS for agencies, consultants and business
          operators to plan and execute local growth (SEO, GBP optimisation, reviews, content,
          social, reports). The Platform is currently in research preview; we make no uptime
          guarantees yet but we work hard to keep it up.
        </p>
      </LegalSection>

      <LegalSection number="02" title="Account">
        <p>
          You must be at least 18 and able to enter into a binding contract. You're
          responsible for keeping your email account secure (we use magic-link sign-in — no
          passwords). One account per individual.
        </p>
      </LegalSection>

      <LegalSection number="03" title="Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "Use the Platform to break the law or violate someone's rights.",
            "Upload personal data of people who haven't consented to your processing.",
            "Generate content that's illegal, hateful, defamatory or that infringes IP.",
            "Try to reverse-engineer the Platform, scrape it, or abuse rate limits.",
            "Resell, sublicense or otherwise commercialise access without our written agreement.",
            "Interfere with other tenants' data or any aspect of multi-tenancy isolation.",
          ]}
        />
      </LegalSection>

      <LegalSection number="04" title="Your data">
        <p>
          You retain all rights to data you upload (your client businesses, services,
          locations, brand info). By using the Platform, you grant us a limited licence to
          process that data solely to deliver the service to you. We never use your data to
          train AI models or for marketing without explicit consent.
        </p>
        <p>
          We may process anonymised, aggregated usage telemetry to improve the Platform — only
          if you accept the Analytics category in cookie preferences.
        </p>
      </LegalSection>

      <LegalSection number="05" title="AI agents — disclosure">
        <p>
          The Platform uses AI agents to generate content drafts, audits, competitor entries
          and reports. These outputs are <strong className="text-vulkan-white">drafts</strong>,
          not facts. You must review them before publishing externally. Agent outputs that
          require approval (content, reviews, social posts, image generation) are marked as
          such and will not be auto-published — a human in your team must confirm.
        </p>
        <p>
          We are not responsible for content you choose to publish based on agent output.
        </p>
      </LegalSection>

      <LegalSection number="06" title="Demo mode">
        <p>
          The public URL of the Platform hosts a demo with three fictional tenants. The demo is
          for evaluation only; data created in demo mode lives in your browser's localStorage
          and is not shared with us. Don't enter real personal data in demo mode if you don't
          intend to keep an account.
        </p>
      </LegalSection>

      <LegalSection number="07" title="Billing">
        <p>
          The current research preview is free. When we introduce paid plans we'll notify you
          in advance and you can choose to upgrade or stop using the Platform.
        </p>
      </LegalSection>

      <LegalSection number="08" title="Termination">
        <p>
          You may close your account anytime from the account settings page (right to
          erasure). We may suspend accounts that violate these terms, with notice when
          possible.
        </p>
      </LegalSection>

      <LegalSection number="09" title="Liability">
        <p>
          The Platform is provided "as is" during research preview. To the maximum extent
          permitted by law, Vulkan Studios isn't liable for indirect or consequential damages,
          lost profits, or reputational damage arising from your use of the Platform. Total
          aggregate liability is capped at the fees you paid us in the 12 months preceding the
          claim (during free preview: zero).
        </p>
      </LegalSection>

      <LegalSection number="10" title="Governing law">
        <p>
          These terms are governed by the laws of Sweden. Disputes resolved by the courts of
          Stockholm, unless mandatory consumer-protection rules require otherwise.
        </p>
      </LegalSection>

      <LegalSection number="11" title="Contact">
        <p>
          Operator: Vulkan Studios.
          <br />
          Contact:{" "}
          <a className="text-vulkan-orange underline" href="mailto:hello@vulkan-studios.com">
            hello@vulkan-studios.com
          </a>
        </p>
      </LegalSection>
    </article>
  );
}
