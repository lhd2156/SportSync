/**
 * SportSync - NewsCard Component
 *
 * Recent sports news card for the dashboard horizontal scroll row.
 * Keeps source first, league second, and gracefully falls back when
 * article images fail to load.
 */
import { memo, useEffect, useState } from "react";

interface NewsCardProps {
  headline: string;
  source: string;
  imageUrl?: string | null;
  publishedAt: string;
  url?: string;
  league?: string;
}

function NewsCard({ headline, source, imageUrl, publishedAt, url, league }: NewsCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [headline, imageUrl]);

  const leagueLabel = league || "News";
  const showImage = Boolean(imageUrl) && !imageFailed;

  const content = (
    <div className="flex-shrink-0 w-72 bg-surface border border-muted/20 rounded-xl overflow-hidden hover:border-accent/30 transition-colors group cursor-pointer">
      <div className="h-32 bg-[radial-gradient(circle_at_top_left,rgba(46,142,255,0.22),transparent_50%),linear-gradient(180deg,rgba(18,18,18,0.96),rgba(11,14,25,0.98))] flex items-center justify-center overflow-hidden">
        {showImage ? (
          <img
            src={imageUrl || undefined}
            alt={headline}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
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
