/**
 * SportSync - NewsCard Component
 *
 * Recent sports news card for the dashboard horizontal scroll row.
 * Shows headline, source, thumbnail placeholder, and timestamp.
 */
import { memo } from "react";

interface NewsCardProps {
  headline: string;
  source: string;
  imageUrl?: string | null;
  publishedAt: string;
  url?: string;
}

function NewsCard({ headline, source, imageUrl, publishedAt, url }: NewsCardProps) {
  const content = (
    <div className="flex-shrink-0 w-72 bg-surface border border-muted/20 rounded-xl overflow-hidden hover:border-accent/30 transition-colors group cursor-pointer">
      {/* Thumbnail */}
      <div className="h-32 bg-background flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={headline} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
        ) : (
          <div className="text-muted text-3xl font-bold opacity-20">
            {source.charAt(0)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-2">
          {headline}
        </h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-accent font-medium">{source}</span>
          <span className="text-xs text-muted">{publishedAt}</span>
        </div>
      </div>
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }

  return content;
}

export default memo(NewsCard);
