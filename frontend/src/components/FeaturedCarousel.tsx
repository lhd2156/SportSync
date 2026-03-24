/**
 * SportSync - FeaturedCarousel Component
 *
 * Twitch-inspired hero carousel at the top of the dashboard.
 * Auto-rotates through featured games with large team badges,
 * scores, and gradient backgrounds. Supports arrow navigation.
 */
import { useState, useEffect, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";

type FeaturedItem = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  statusDetail?: string;
  league: string;
  homeBadge: string | null;
  awayBadge: string | null;
  thumb: string | null;
  dateEvent: string;
  strTime: string;
  strEvent: string;
  strVenue: string;
};

type FeaturedCarouselProps = {
  items: FeaturedItem[];
};

/* Gradient presets for visual variety across carousel slides */
const GRADIENTS = [
  "from-[color:var(--carousel-blue-start)] via-[color:var(--carousel-blue-mid)] to-background",
  "from-[color:var(--carousel-purple-start)] via-[color:var(--carousel-purple-mid)] to-background",
  "from-[color:var(--carousel-emerald-start)] via-[color:var(--carousel-emerald-mid)] to-background",
  "from-[color:var(--carousel-rose-start)] via-[color:var(--carousel-rose-mid)] to-background",
  "from-[color:var(--carousel-amber-start)] via-[color:var(--carousel-amber-mid)] to-background",
  "from-[color:var(--carousel-cyan-start)] via-[color:var(--carousel-cyan-mid)] to-background",
];

const AUTO_ADVANCE_MS = 8000;
const warmedFeaturedImageUrls = new Set<string>();

function slugifySegment(value?: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function warmFeaturedImage(url?: string | null): void {
  if (typeof window === "undefined" || !url || warmedFeaturedImageUrls.has(url)) {
    return;
  }

  warmedFeaturedImageUrls.add(url);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

function FeaturedCarousel({ items }: FeaturedCarouselProps) {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const count = items.length;

  const goTo = useCallback(
    (idx: number) => {
      if (isTransitioning || count === 0) return;
      setIsTransitioning(true);
      setActiveIndex((idx + count) % count);
      setTimeout(() => setIsTransitioning(false), 500);
    },
    [count, isTransitioning]
  );

  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const goPrev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  /* Auto-advance every 8 seconds */
  useEffect(() => {
    if (count <= 1) return;
    const timer = setInterval(goNext, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [count, goNext]);

  useEffect(() => {
    items.forEach((featuredItem) => {
      warmFeaturedImage(featuredItem.homeBadge);
      warmFeaturedImage(featuredItem.awayBadge);
      warmFeaturedImage(featuredItem.thumb);
    });
  }, [items]);

  if (count === 0) return null;

  const item = items[activeIndex];
  const gradient = GRADIENTS[activeIndex % GRADIENTS.length];
  const gameSlug = `${slugifySegment(item.league)}-${slugifySegment(item.awayTeam)}-${slugifySegment(item.homeTeam)}-${item.id}`;

  const openGame = useCallback(() => {
    navigate(`/games/${gameSlug}`);
  }, [gameSlug, navigate]);

  const statusLabel =
    item.status === "live"
      ? "LIVE"
      : item.status === "final"
      ? "FINAL"
      : "UPCOMING";

  const statusColor =
    item.status === "live"
      ? "bg-[color:var(--danger-strong)]"
      : item.status === "final"
      ? "bg-muted/40"
      : "bg-accent";

  return (
    <section className="relative w-full overflow-hidden mb-2">
      {/* Background layer with gradient */}
      <div
        className={`relative w-full bg-gradient-to-r ${gradient} rounded-2xl mx-auto max-w-7xl carousel-slide cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        key={item.id}
        role="link"
        tabIndex={0}
        onClick={openGame}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openGame();
          }
        }}
        aria-label={`Open ${item.strEvent}`}
      >
        {/* Thumbnail background if available */}
        {item.thumb && (
          <div className="absolute inset-0 overflow-hidden rounded-2xl">
            <img
              src={item.thumb}
              alt=""
              className="w-full h-full object-cover opacity-15 blur-sm"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
          </div>
        )}

        {/* Card content */}
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between px-6 md:px-12 py-8 md:py-12 min-h-[220px] md:min-h-[280px]">
          {/* Left: game info */}
          <div className="flex flex-col items-center md:items-start gap-3 mb-4 md:mb-0">
            <div className="flex items-center gap-2">
              <span
                className={`${statusColor} text-foreground text-xs font-bold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                  item.status === "live" ? "animate-pulse-live" : ""
                }`}
              >
                {statusLabel}
              </span>
              {item.status === "live" && item.statusDetail && (
                <span className="text-accent text-sm font-semibold">
                  {item.statusDetail}
                </span>
              )}
              <span className="text-muted text-sm font-medium">
                {item.league}
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold text-foreground text-center md:text-left leading-tight">
              {item.strEvent}
            </h2>

            {item.strVenue && (
              <p className="text-sm text-muted">{item.strVenue}</p>
            )}

            {item.dateEvent && (
              <p className="text-xs text-muted/70">
                {new Date(item.dateEvent + "T00:00:00").toLocaleDateString(
                  "en-US",
                  { weekday: "short", month: "short", day: "numeric" }
                )}
              </p>
            )}
          </div>

          {/* Center: team matchup with badges */}
          <div className="flex items-center gap-4 md:gap-8">
            {/* Home team */}
            <div className="flex flex-col items-center gap-2">
              {item.homeBadge ? (
                <img
                  src={item.homeBadge}
                  alt={item.homeTeam}
                  className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-lg"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              ) : (
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface flex items-center justify-center text-2xl font-bold text-accent">
                  {item.homeTeam.charAt(0)}
                </div>
              )}
              <span className="text-sm text-foreground-base font-medium text-center max-w-[100px] truncate">
                {item.homeTeam}
              </span>
            </div>

            {/* Score or VS */}
            <div className="flex flex-col items-center">
              {item.status === "upcoming" ? (
                <span className="text-2xl md:text-3xl font-bold text-muted">
                  VS
                </span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-3xl md:text-5xl font-black text-foreground tabular-nums">
                    {item.homeScore}
                  </span>
                  <span className="text-xl md:text-2xl text-muted font-light">
                    -
                  </span>
                  <span className="text-3xl md:text-5xl font-black text-foreground tabular-nums">
                    {item.awayScore}
                  </span>
                </div>
              )}
            </div>

            {/* Away team */}
            <div className="flex flex-col items-center gap-2">
              {item.awayBadge ? (
                <img
                  src={item.awayBadge}
                  alt={item.awayTeam}
                  className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-lg"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              ) : (
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface flex items-center justify-center text-2xl font-bold text-accent">
                  {item.awayTeam.charAt(0)}
                </div>
              )}
              <span className="text-sm text-foreground-base font-medium text-center max-w-[100px] truncate">
                {item.awayTeam}
              </span>
            </div>
          </div>

          {/* Right side: small preview thumbnails of upcoming slides */}
          <div className="hidden lg:flex flex-col gap-2 ml-4">
            {items
              .slice(activeIndex + 1, activeIndex + 4)
              .concat(items.slice(0, Math.max(0, 3 - (count - activeIndex - 1))))
              .slice(0, 3)
              .map((preview, i) => (
                <button
                  key={preview.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    goTo((activeIndex + 1 + i) % count);
                  }}
                  className="flex items-center gap-2 bg-surface/60 hover:bg-surface rounded-lg px-3 py-2 transition-colors text-left w-48"
                >
                  {preview.homeBadge && (
                    <img
                      src={preview.homeBadge}
                      alt=""
                      className="w-6 h-6 object-contain"
                      loading="eager"
                      fetchPriority="low"
                      decoding="async"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">
                      {preview.homeTeam} vs {preview.awayTeam}
                    </p>
                    <p className="text-[10px] text-muted">{preview.league}</p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Navigation arrows — glassmorphism style */}
      {count > 1 && (
        <>
          <button
            onClick={(event) => {
              event.stopPropagation();
              goPrev();
            }}
            aria-label="Previous slide"
            className="absolute left-3 md:left-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/30 backdrop-blur-md hover:bg-black/50 border border-white/10 flex items-center justify-center text-white/90 transition-all hover:scale-110 active:scale-95 z-20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
            aria-label="Next slide"
            className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/30 backdrop-blur-md hover:bg-black/50 border border-white/10 flex items-center justify-center text-white/90 transition-all hover:scale-110 active:scale-95 z-20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        </>
      )}

      {/* Dot indicators */}
      {count > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`rounded-full transition-all ${
                i === activeIndex
                  ? "w-6 h-2 bg-accent"
                  : "w-2 h-2 bg-muted/40 hover:bg-muted"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(FeaturedCarousel);
