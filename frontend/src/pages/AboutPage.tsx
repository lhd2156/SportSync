import { ROUTES, APP_VERSION } from "../constants";
import StaticPageShell, { StaticPageSection } from "../components/StaticPageShell";

const sectionLinks = [
  { id: "mission", label: "Mission" },
  { id: "platform", label: "Platform" },
  { id: "data", label: "Data and predictions" },
  { id: "trust", label: "Trust and privacy" },
  { id: "contact", label: "Contact" },
];

const relatedLinks = [
  { label: "Privacy Policy", to: ROUTES.PRIVACY },
  { label: "Terms of Service", to: ROUTES.TERMS },
  { label: "Cookie Policy", to: ROUTES.COOKIES },
];

const platformCards = [
  {
    title: "Live coverage",
    description:
      "Follow live scores, play-by-play, game detail, and momentum without bouncing across multiple apps.",
  },
  {
    title: "Deeper context",
    description:
      "Standings, team pages, box scores, leaders, and historical schedule views keep every game grounded in context.",
  },
  {
    title: "Personalized workflow",
    description:
      "Saved teams, filtered activity, and tailored dashboard ordering help the product adapt to the sports and clubs that matter to you.",
  },
];

const trustCards = [
  {
    title: "Clear predictions",
    description:
      "Model outputs are presented as probabilities, not guarantees, so the product stays useful without overstating certainty.",
  },
  {
    title: "Security controls",
    description:
      "SportSync uses modern account protections such as hashed passwords, session protections, and abuse controls designed to protect sign-in flows.",
  },
  {
    title: "Consent-aware experience",
    description:
      "Cookie preferences and privacy links are surfaced directly in the product so users can understand and manage key settings.",
  },
];

export default function AboutPage() {
  return (
    <StaticPageShell
      eyebrow="About"
      title="A sports workspace built for people who want speed, context, and clarity."
      subtitle="SportSync brings live scores, team context, standings, highlights, and model-driven probability into one experience so following a game feels informed rather than fragmented."
      metadata={[
        { label: "Coverage", value: "NFL, NBA, MLB, NHL, and EPL" },
        { label: "Experience", value: "Live activity, game detail, standings, teams, and highlights" },
        { label: "Approach", value: "Personalized, real-time, and probability-aware" },
        { label: "Version", value: `SportSync v${APP_VERSION}` },
      ]}
      sectionLinks={sectionLinks}
      relatedLinks={relatedLinks}
    >
      <StaticPageSection
        id="mission"
        title="Mission"
        summary="Public-facing about pages from strong product companies usually lead with why the product exists, not the implementation details. SportSync follows that same pattern here."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            SportSync exists to reduce the friction of following sports seriously. Scores alone are not enough, and raw data without context is rarely satisfying. The goal is to make live games, team tracking, and league movement easier to understand in one place.
          </p>
          <p>
            The platform is designed for people who want a faster command center: a place where the current game state, the surrounding context, and the most relevant updates can be read quickly and trusted at a glance.
          </p>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="platform"
        title="What the platform is built to do"
        summary="Instead of acting like a single-feature scores page, SportSync is structured as a connected product surface."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {platformCards.map((card) => (
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
        id="data"
        title="Data and prediction philosophy"
        summary="The product combines third-party sports data with in-app modeling, but it is careful about how that information is framed."
      >
        <div className="space-y-4 text-sm leading-7 text-muted">
          <p>
            Live scores, schedules, standings, and related team information are sourced through third-party sports data providers and normalized for use inside SportSync. Because those feeds are external, timing and completeness can vary by league, event state, or provider response.
          </p>
          <p>
            Model outputs are shown as probability estimates intended to add context before, during, and after games. They are not guarantees, not betting advice, and not a substitute for official results.
          </p>
          <div className="rounded-2xl border border-accent/15 bg-accent/6 p-5">
            <p className="text-sm leading-7 text-foreground-base">
              Detailed technology-stack inventories are intentionally not the centerpiece of this page. That is more common in engineering or documentation surfaces than in polished public company About pages, so this page stays focused on product, trust, and user value.
            </p>
          </div>
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="trust"
        title="Trust, privacy, and product standards"
        summary="Professional product pages usually make trust visible without turning the About page into a legal document."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {trustCards.map((card) => (
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
        id="contact"
        title="Contact and related policies"
        summary="The About page should make it easy to understand where to go for legal, privacy, or support questions."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-muted/15 bg-background/35 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">General</p>
            <p className="mt-3 text-sm leading-7 text-muted">
              For general product or business inquiries, use the legal and privacy channels below to route requests to the right place.
            </p>
          </div>
          <div className="rounded-2xl border border-muted/15 bg-background/35 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Policy contacts</p>
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p>
                Privacy:{" "}
                <a href="mailto:privacy@sportsync.app" className="text-accent transition-colors hover:text-accent-hover">
                  privacy@sportsync.app
                </a>
              </p>
              <p>
                Legal:{" "}
                <a href="mailto:legal@sportsync.app" className="text-accent transition-colors hover:text-accent-hover">
                  legal@sportsync.app
                </a>
              </p>
            </div>
          </div>
        </div>
      </StaticPageSection>
    </StaticPageShell>
  );
}
