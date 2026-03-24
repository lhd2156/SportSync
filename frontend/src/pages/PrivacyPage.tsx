import { Link } from "react-router-dom";
import { ROUTES } from "../constants";
import StaticPageShell, { StaticPageSection } from "../components/StaticPageShell";

const sectionLinks = [
  { id: "information", label: "Information we collect" },
  { id: "use", label: "How we use information" },
  { id: "cookies", label: "Cookies and preferences" },
  { id: "sharing", label: "Sharing and disclosures" },
  { id: "security-retention", label: "Security and retention" },
  { id: "rights", label: "Rights and choices" },
  { id: "children", label: "Children's privacy" },
  { id: "changes-contact", label: "Changes and contact" },
];

const relatedLinks = [
  { label: "Terms of Service", to: ROUTES.TERMS },
  { label: "Cookie Policy", to: ROUTES.COOKIES },
  { label: "About SportSync", to: ROUTES.ABOUT },
];

const collectedData = [
  {
    title: "Account information",
    description:
      "Information such as email address, display name, optional profile data, and authentication-related account records.",
  },
  {
    title: "Preferences and product choices",
    description:
      "Saved teams, selected sports, onboarding choices, and product settings that help personalize the experience.",
  },
  {
    title: "Usage and device information",
    description:
      "Technical signals such as browser details, device attributes, request timestamps, IP-based security logs, and interaction patterns.",
  },
];

const useCases = [
  "Provide and maintain the product.",
  "Personalize dashboards, saved-team views, and relevant sports content.",
  "Authenticate users and secure accounts.",
  "Operate security controls such as abuse detection, rate limiting, and account protection workflows.",
  "Understand product usage at an aggregate level and improve performance, reliability, and usability.",
];

const rightsItems = [
  "Access information we hold about you.",
  "Correct inaccurate or incomplete account information.",
  "Request deletion of your account and associated data, subject to legal or operational exceptions.",
  "Request a portable copy of data where applicable law provides that right.",
  "Adjust non-essential cookie preferences through in-product consent controls.",
];

export default function PrivacyPage() {
  return (
    <StaticPageShell
      eyebrow="Privacy"
      title="Privacy Policy"
      subtitle="This policy explains what information SportSync collects, how it is used, and the choices available to people who use the product."
      lastUpdated="March 21, 2026"
      metadata={[
        { label: "Focus", value: "Transparency, product operation, and user choice" },
        { label: "Covers", value: "Account data, usage data, cookies, and security records" },
        { label: "Contact", value: "privacy@sportsync.app" },
      ]}
      sectionLinks={sectionLinks}
      relatedLinks={relatedLinks}
    >
      <StaticPageSection
        id="information"
        title="Information we collect"
        summary="Strong privacy pages lead with categories people can understand, rather than burying them in jargon."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {collectedData.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-muted/15 bg-background/35 p-5"
            >
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="use"
        title="How we use information"
        summary="We use information to operate the product, personalize it, and protect it."
      >
        <div className="rounded-2xl border border-muted/15 bg-background/35 p-5">
          <ul className="space-y-3 text-sm leading-7 text-muted">
            {useCases.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="cookies"
        title="Cookies and preference management"
        summary="Cookie practices are addressed in their own policy, but the privacy policy should still explain the role they play."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            SportSync uses cookies and similar browser storage mechanisms to support login state, privacy preferences, and selected product settings. Some of these technologies are essential to make authenticated experiences work correctly.
          </p>
          <p>
            You can review more detail in our{" "}
            <Link to={ROUTES.COOKIES} className="text-accent transition-colors hover:text-accent-hover">
              Cookie Policy
            </Link>
            , and you can manage non-essential categories through the product's consent controls when available.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="sharing"
        title="Sharing and disclosures"
        summary="The goal here is clarity: when we share data, it should be understandable why."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            We do not sell personal information. We may share information with service providers and vendors that help us host, secure, authenticate, or operate the service.
          </p>
          <p>
            If you choose to sign in with Google, Google processes the authentication flow under its own terms and privacy practices. If you access third-party links or provider-hosted assets, those services may also receive technical request information consistent with normal web operation.
          </p>
          <p>
            We may also disclose information when required by law, to protect rights and safety, or in connection with a corporate transaction such as a merger, financing, acquisition, or asset sale.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="security-retention"
        title="Security and retention"
        summary="This section should be specific enough to build trust without making promises the product cannot support."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            SportSync uses reasonable administrative, technical, and organizational safeguards intended to protect personal information. These safeguards include account security controls, hashed passwords, session protections, and abuse-mitigation measures such as rate limiting and login protection workflows.
          </p>
          <p>
            We retain information for as long as needed to operate the service, comply with legal obligations, resolve disputes, enforce agreements, and maintain legitimate business records. Retention periods may vary depending on the type of data and the purpose for which it was collected.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="rights"
        title="Rights and choices"
        summary="Privacy rights depend on applicable law, but users should still be told what kinds of requests are generally supported."
      >
        <div className="rounded-2xl border border-muted/15 bg-background/35 p-5">
          <ul className="space-y-3 text-sm leading-7 text-muted">
            {rightsItems.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-7 text-muted">
            To make a privacy request or ask a question about your information, contact{" "}
            <a href="mailto:privacy@sportsync.app" className="text-accent transition-colors hover:text-accent-hover">
              privacy@sportsync.app
            </a>
            .
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="children"
        title="Children's privacy"
        summary="The product is not designed for minors."
      >
        <p className="text-sm leading-7 text-muted">
          SportSync is intended for users who are at least 18 years old. We do not knowingly provide the service to children or intentionally collect personal information from users under that age threshold.
        </p>
      </StaticPageSection>

      <StaticPageSection
        id="changes-contact"
        title="Changes and contact"
        summary="Good policy pages close with a simple explanation of updates and a direct contact path."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            We may update this policy as the product, legal requirements, or data practices evolve. When that happens, we will revise the date at the top of this page and, where appropriate, provide additional notice inside the product.
          </p>
          <p>
            For privacy-related questions, contact{" "}
            <a href="mailto:privacy@sportsync.app" className="text-accent transition-colors hover:text-accent-hover">
              privacy@sportsync.app
            </a>
            .
          </p>
        </div>
      </StaticPageSection>
    </StaticPageShell>
  );
}
