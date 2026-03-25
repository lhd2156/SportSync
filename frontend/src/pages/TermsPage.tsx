import { ROUTES, CONTACT_EMAILS } from "../constants";
import StaticPageShell, { StaticPageSection } from "../components/StaticPageShell";

const sectionLinks = [
  { id: "scope", label: "Scope and eligibility" },
  { id: "accounts", label: "Accounts and security" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "data-and-predictions", label: "Data and predictions" },
  { id: "intellectual-property", label: "Intellectual property" },
  { id: "termination", label: "Suspension and termination" },
  { id: "liability", label: "Disclaimers and liability" },
  { id: "governing-law", label: "Governing law" },
  { id: "contact", label: "Contact" },
];

const relatedLinks = [
  { label: "Privacy Policy", to: ROUTES.PRIVACY },
  { label: "Cookie Policy", to: ROUTES.COOKIES },
  { label: "About SportSync", to: ROUTES.ABOUT },
];

const acceptableUseItems = [
  "Use the service only for lawful purposes.",
  "Do not attempt to access systems, accounts, or data you are not authorized to access.",
  "Do not interfere with product performance, security features, or service availability.",
  "Do not scrape, harvest, or automate access to the service in a way that violates these terms or applicable law.",
  "Do not impersonate another person, organization, or affiliation.",
];

export default function TermsPage() {
  return (
    <StaticPageShell
      eyebrow="Legal"
      title="Terms of Service"
      subtitle="These terms govern access to SportSync and describe the rules, responsibilities, and limits that apply when you use the product."
      lastUpdated="March 21, 2026"
      metadata={[
        { label: "Applies to", value: "Website, authenticated product surfaces, and related services" },
        { label: "Audience", value: "Users who are at least 18 years old" },
        { label: "Related", value: "Privacy Policy and Cookie Policy" },
      ]}
      sectionLinks={sectionLinks}
      relatedLinks={relatedLinks}
    >
      <StaticPageSection
        id="scope"
        title="Scope and eligibility"
        summary="Professional legal pages are easiest to trust when they explain scope clearly at the top."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            By accessing or using SportSync, you agree to these Terms of Service. If you do not agree, do not access or use the service.
          </p>
          <p>
            SportSync is intended for users who are at least 18 years old. By creating an account or using the service, you represent that you meet that requirement and that you can form a binding agreement.
          </p>
          <p>
            We may revise these terms from time to time. When we do, the updated version will be posted here with a new effective date. Continued use of the service after changes take effect means you accept the revised terms.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="accounts"
        title="Accounts and security"
        summary="Your account is the entry point to personalized features, so it comes with a responsibility to protect access."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            Some features require an account. When you register, you agree to provide accurate information and to keep your credentials secure.
          </p>
          <p>
            You are responsible for activity that occurs under your account and for maintaining the confidentiality of your login credentials. If you believe your account has been used without authorization, contact us promptly.
          </p>
          <p>
            We may apply security controls such as authentication checks, rate limiting, or temporary lockouts to protect accounts and service integrity.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="acceptable-use"
        title="Acceptable use"
        summary="This section sets practical boundaries around how the service may be used."
      >
        <div className="rounded-2xl border border-muted/15 bg-background/35 p-5">
          <ul className="space-y-3 text-sm leading-7 text-muted">
            {acceptableUseItems.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="data-and-predictions"
        title="Sports data and predictions"
        summary="This is a sports product, so it is important to be explicit about what is official and what is modeled."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            SportSync uses third-party sports data providers. Because those feeds are external, information may occasionally be delayed, incomplete, unavailable, or corrected after publication.
          </p>
          <p>
            Predictions and win probabilities are model-generated estimates provided for informational and entertainment purposes only. They are not guarantees, not official results, and not financial, wagering, or investment advice.
          </p>
          <p>
            You are responsible for how you interpret and use the information presented through the service.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="intellectual-property"
        title="Intellectual property"
        summary="This section clarifies product ownership while respecting league and team marks."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            SportSync and its original product design, software, text, branding, and related materials are protected by applicable intellectual property laws.
          </p>
          <p>
            Team names, league names, logos, and other third-party marks remain the property of their respective owners and are used for identification and informational purposes.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="termination"
        title="Suspension and termination"
        summary="We reserve the right to act when conduct creates risk for the service or other users."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            We may suspend, restrict, or terminate access if we reasonably believe a user has violated these terms, created security risk, abused the service, or used the platform in a way that could harm SportSync or others.
          </p>
          <p>
            You may stop using the service at any time, and you may request account deletion through available product settings where supported.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="liability"
        title="Disclaimers and limitation of liability"
        summary="This section is written plainly, but the intent is the same as the standard limitations used across modern product companies."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            The service is provided on an "as is" and "as available" basis to the fullest extent permitted by law. We do not warrant that the service will always be uninterrupted, error-free, or perfectly accurate.
          </p>
          <p>
            To the fullest extent permitted by law, SportSync will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, data, or goodwill arising from or related to your use of the service.
          </p>
          <p>
            Where liability cannot be excluded, it will be limited to the maximum extent permitted under applicable law.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="governing-law"
        title="Governing law"
        summary="Jurisdiction and venue help define where disputes are resolved."
      >
        <p className="text-sm leading-7 text-muted">
          These terms are governed by the laws of the State of New York, without regard to conflict-of-law principles. Unless applicable law requires otherwise, disputes related to these terms or the service will be resolved in the state or federal courts located in New York County, New York.
        </p>
      </StaticPageSection>

      <StaticPageSection
        id="contact"
        title="Contact"
        summary="Questions about these terms should have a direct legal channel."
      >
        <p className="text-sm leading-7 text-muted">
          For questions about these Terms of Service, contact{" "}
          <a href={`mailto:${CONTACT_EMAILS.LEGAL}`} className="text-accent transition-colors hover:text-accent-hover">
            {CONTACT_EMAILS.LEGAL}
          </a>
          .
        </p>
      </StaticPageSection>
    </StaticPageShell>
  );
}
