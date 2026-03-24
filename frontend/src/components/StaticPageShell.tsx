import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Footer from "./Footer";
import Logo from "./Logo";
import { ROUTES } from "../constants";

type StaticPageMetadataItem = {
  label: string;
  value: string;
};

type StaticPageNavItem = {
  id?: string;
  label: string;
  to?: string;
};

type StaticPageShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  lastUpdated?: string;
  metadata?: StaticPageMetadataItem[];
  sectionLinks?: StaticPageNavItem[];
  relatedLinks?: StaticPageNavItem[];
  children: ReactNode;
};

type StaticPageSectionProps = {
  id: string;
  title: string;
  summary?: string;
  children: ReactNode;
};

export function StaticPageSection({ id, title, summary, children }: StaticPageSectionProps) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-muted/10 pt-8 first:border-t-0 first:pt-0">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {summary && (
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted">
            {summary}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export default function StaticPageShell({
  eyebrow,
  title,
  subtitle,
  lastUpdated,
  metadata = [],
  sectionLinks = [],
  relatedLinks = [],
  children,
}: StaticPageShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground-base">
      <header className="border-b border-muted/15 bg-background/85 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Logo size="sm" linkTo={ROUTES.HOME} />
          <Link
            to={ROUTES.HOME}
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="px-6 py-8 md:py-12">
        <div className="mx-auto max-w-6xl">
          <section className="surface-static-shell-hero overflow-hidden rounded-[28px] border border-muted/15 p-8 md:p-10">
            <div className="max-w-4xl">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-accent">
                  {eyebrow}
                </span>
                {lastUpdated && (
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                    Last updated {lastUpdated}
                  </span>
                )}
              </div>

              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-muted sm:text-lg">
                {subtitle}
              </p>

              {metadata.length > 0 && (
                <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {metadata.map((item) => (
                    <div
                      key={item.label}
                      className="surface-static-shell-meta rounded-2xl px-4 py-4 backdrop-blur-sm"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                        {item.label}
                      </p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
              {sectionLinks.length > 0 && (
                <div className="rounded-2xl border border-muted/15 bg-surface/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    On this page
                  </p>
                  <nav className="mt-4 flex flex-col gap-2">
                    {sectionLinks.map((item) => (
                      <a
                        key={item.id || item.label}
                        href={item.id ? `#${item.id}` : item.to || "#"}
                        className="rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-accent/8 hover:text-foreground"
                      >
                        {item.label}
                      </a>
                    ))}
                  </nav>
                </div>
              )}

              {relatedLinks.length > 0 && (
                <div className="rounded-2xl border border-muted/15 bg-surface/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    Related pages
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    {relatedLinks.map((item) => (
                      <Link
                        key={item.to || item.label}
                        to={item.to || ROUTES.HOME}
                        className="rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-accent/8 hover:text-foreground"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            <article className="surface-static-shell-article rounded-[28px] border border-muted/15 bg-surface/85 p-6 md:p-8">
              <div className="space-y-8 md:space-y-10">
                {children}
              </div>
            </article>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
