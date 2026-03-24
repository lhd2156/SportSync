/**
 * SportSync - NewsCard Component
 *
 * Recent sports news card for the dashboard horizontal scroll row.
 * Keeps source first, league second, and gracefully falls back when
 * article images fail to load.
 */
import { memo, useEffect, useState } from "react";

type NewsCardProps = {
  headline: string;
  source: string;
  imageUrl?: string | null;
  publishedAt: string;
  url?: string;
  league?: string;
  priority?: boolean;
};

function getOutletDomain(source: string, url?: string): string {
  try {
    if (url) {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, "").trim();
      if (hostname) {
        return hostname;
      }
    }
  } catch {
    // Fall back to source mapping below.
  }

  const sourceKey = source.toLowerCase();
  if (sourceKey.includes("yahoo")) return "sports.yahoo.com";
  if (sourceKey.includes("cbs")) return "cbssports.com";
  if (sourceKey.includes("bleacher")) return "bleacherreport.com";
  if (sourceKey.includes("espn")) return "espn.com";
  if (sourceKey.includes("fox")) return "foxsports.com";
  if (sourceKey.includes("the athletic")) return "theathletic.com";
  return "";
}

function NewsCard({ headline, source, imageUrl, publishedAt, url, league, priority = false }: NewsCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setLogoFailed(false);
  }, [headline, imageUrl, source, url]);

  const leagueLabel = league || "News";
  const showImage = Boolean(imageUrl) && !imageFailed;
  const outletDomain = getOutletDomain(source, url);
  const outletLogoUrl = outletDomain
    ? `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(outletDomain)}`
    : "";
  const showOutletLogo = !showImage && Boolean(outletLogoUrl) && !logoFailed;

  const content = (
    <div className="flex-shrink-0 w-72 bg-surface border border-muted/20 rounded-xl overflow-hidden hover:border-accent/30 transition-colors group cursor-pointer">
      <div className="surface-news-card-media h-32 flex items-center justify-center overflow-hidden">
        {showImage ? (
          <img
            src={imageUrl || undefined}
            alt={headline}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : showOutletLogo ? (
          <div className="flex h-full w-full items-center justify-center px-6">
            <div className="flex flex-col items-center justify-center text-center">
              <img
                src={outletLogoUrl}
                alt={`${source} logo`}
                className="mb-3 h-14 w-14 rounded-2xl border border-muted/20 bg-surface/70 p-2 object-contain"
                loading={priority ? "eager" : "lazy"}
                fetchPriority={priority ? "high" : "auto"}
                decoding="async"
                onError={() => setLogoFailed(true)}
              />
              <p className="text-accent text-xs font-semibold uppercase tracking-[0.18em]">
                {source}
              </p>
              <p className="mt-1 text-muted text-sm">{leagueLabel}</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-6 text-center">
            <div>
              <p className="text-accent text-xs font-semibold uppercase tracking-[0.18em] mb-2">
                {source}
              </p>
              <p className="text-muted text-sm">{leagueLabel}</p>
            </div>
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-3">
          {headline}
        </h3>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2 text-xs">
            <span className="truncate text-accent font-semibold">{source}</span>
            <span className="h-1 w-1 rounded-full bg-muted/40 flex-none" />
            <span className="truncate text-muted">{leagueLabel}</span>
          </div>
          <span className="text-xs text-muted flex-none">{publishedAt}</span>
        </div>
      </div>
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }

  return content;
}

export default memo(NewsCard);
