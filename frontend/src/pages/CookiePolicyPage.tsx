import StaticPageShell, { StaticPageSection } from "../components/StaticPageShell";
import { ROUTES, CONTACT_EMAILS } from "../constants";

const sectionLinks = [
  { id: "overview", label: "What cookies are" },
  { id: "categories", label: "Cookie categories" },
  { id: "product-cookies", label: "Cookies used by SportSync" },
  { id: "choices", label: "Your choices" },
  { id: "third-parties", label: "Third-party services" },
  { id: "contact", label: "Contact" },
];

const relatedLinks = [
  { label: "Privacy Policy", to: ROUTES.PRIVACY },
  { label: "Terms of Service", to: ROUTES.TERMS },
  { label: "About SportSync", to: ROUTES.ABOUT },
];

const cookieRows = [
  {
    name: "refresh_token",
    type: "Essential",
    purpose: "Maintains the authenticated session securely for signed-in users.",
    duration: "Up to 30 days, depending on sign-in choice",
  },
  {
    name: "session_token",
    type: "Functional",
    purpose: "Supports optional persistent sign-in behavior when a user chooses Remember Me.",
    duration: "Up to 30 days",
  },
  {
    name: "cookie_consent",
    type: "Essential",
    purpose: "Stores whether cookie preferences have been provided.",
    duration: "365 days",
  },
  {
    name: "cookie_prefs",
    type: "Functional",
    purpose: "Stores saved cookie category preferences such as functional and analytics choices.",
    duration: "365 days",
  },
];

const categoryCards = [
  {
    title: "Essential",
    description:
      "Required for core product operation such as sign-in state, security controls, and remembering that you made a consent choice.",
  },
  {
    title: "Functional",
    description:
      "Used for optional product behavior and convenience settings, such as persisted preferences when those features are enabled.",
  },
  {
    title: "Analytics",
    description:
      "Reserved for measurement or product-improvement tooling when enabled. If specific analytics cookies are introduced, this policy will be updated to identify them.",
  },
];

export default function CookiePolicyPage() {
  return (
    <StaticPageShell
      eyebrow="Cookies"
      title="Cookie Policy"
      subtitle="This page explains how SportSync uses cookies and similar browser technologies, what categories they fall into, and how users can manage their choices."
      lastUpdated="March 21, 2026"
      metadata={[
        { label: "Focus", value: "Consent, authentication, and preference controls" },
        { label: "Current model", value: "Essential and functional cookies in active use" },
        { label: "Related", value: "Privacy Policy and in-product cookie settings" },
      ]}
      sectionLinks={sectionLinks}
      relatedLinks={relatedLinks}
    >
      <StaticPageSection
        id="overview"
        title="What cookies are"
        summary="Professional cookie pages work best when they define the basics before listing technical details."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            Cookies are small text files stored in your browser or device when you visit a website. They help a service remember state, recognize preferences, support authentication, and measure how product experiences are performing.
          </p>
          <p>
            SportSync uses cookies and related browser storage mechanisms to support account access, preference controls, and certain product settings. Some are necessary for the service to function correctly, while others are optional.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="categories"
        title="Cookie categories"
        summary="Grouping cookies by purpose makes the policy easier to understand and aligns with how modern consent flows are usually presented."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {categoryCards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-muted/15 bg-background/35 p-5"
            >
              <h3 className="text-base font-semibold text-foreground">{card.title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted">{card.description}</p>
            </div>
          ))}
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="product-cookies"
        title="Cookies used by SportSync"
        summary="Only cookies that are currently represented in the product and codebase are listed here."
      >
        <div className="overflow-hidden rounded-2xl border border-muted/15 bg-background/35">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="border-b border-muted/15 bg-black/10">
                <tr>
                  <th className="px-5 py-4 font-semibold text-foreground">Cookie</th>
                  <th className="px-5 py-4 font-semibold text-foreground">Category</th>
                  <th className="px-5 py-4 font-semibold text-foreground">Purpose</th>
                  <th className="px-5 py-4 font-semibold text-foreground">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-muted/10">
                {cookieRows.map((row) => (
                  <tr key={row.name}>
                    <td className="px-5 py-4 font-mono text-xs text-foreground-base">{row.name}</td>
                    <td className="px-5 py-4 text-muted">{row.type}</td>
                    <td className="px-5 py-4 text-muted">{row.purpose}</td>
                    <td className="px-5 py-4 text-muted">{row.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-4 text-sm leading-7 text-muted">
          SportSync does not currently describe any advertising-cookie program on this page. If cookie usage changes in a material way, this policy should be updated to reflect the new practice.
        </p>
      </StaticPageSection>

      <StaticPageSection
        id="choices"
        title="Your choices"
        summary="Consent controls should be easy to understand and easy to revisit."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            You can provide or revise cookie preferences through the in-product cookie banner and cookie settings controls where available. Essential cookies remain active because they are necessary for core service functionality.
          </p>
          <p>
            Most browsers also allow you to review, block, or delete cookies through browser settings. Blocking essential cookies may prevent some parts of SportSync from working as intended.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="third-parties"
        title="Third-party services"
        summary="Third-party integrations can create their own browser-side behavior, so this should be acknowledged clearly."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            If you use third-party sign-in or follow links to external services, those services may set or read cookies under their own policies. For example, using Google sign-in may involve Google-controlled cookies that are not managed by SportSync.
          </p>
          <p>
            We recommend reviewing the privacy and cookie information published by those providers directly if you use those services.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="contact"
        title="Contact"
        summary="Cookie and privacy questions should route to the same privacy contact."
      >
        <p className="text-sm leading-7 text-muted">
          For questions about this Cookie Policy or SportSync's privacy practices, contact{" "}
          <a href={`mailto:${CONTACT_EMAILS.PRIVACY}`} className="text-accent transition-colors hover:text-accent-hover">
            {CONTACT_EMAILS.PRIVACY}
          </a>
          .
        </p>
      </StaticPageSection>
    </StaticPageShell>
  );
}
