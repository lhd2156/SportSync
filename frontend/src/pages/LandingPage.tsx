/**
 * SportSync - Landing Page
 *
 * Public marketing page with CTAs to register or log in.
 * Showcases supported sports and key features.
 */
import { Link } from "react-router-dom";
import { ROUTES, SUPPORTED_SPORTS } from "../constants";
import Logo from "../components/Logo";
import Footer from "../components/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav bar */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-muted/10">
        <Logo size="md" linkTo={null} />
        <div className="flex items-center gap-3">
          <Link
            to={ROUTES.LOGIN}
            className="px-5 py-2 text-sm text-foreground-base hover:text-foreground transition-colors"
          >
            Sign In
          </Link>
          <Link
            to={ROUTES.REGISTER}
            className="px-5 py-2 text-sm bg-accent hover:bg-accent-hover text-foreground font-medium rounded-lg transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero section */}
      <header className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-10">
          <div className="flex justify-center mb-6">
            <img src="/favicon.svg" alt="SportSync" className="w-20 h-20" />
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold mb-4 tracking-tight">
            <span className="text-accent">Sport</span>
            <span className="text-foreground">Sync</span>
          </h1>
          <p className="text-xl text-foreground-base max-w-2xl mx-auto leading-relaxed">
            Your personalized sports command center. Live scores, real-time updates,
            and ML-powered predictions across NFL, NBA, MLB, NHL, MLS, and EPL.
          </p>
        </div>

        <div className="flex gap-4 mb-16">
          <Link
            to={ROUTES.REGISTER}
            className="px-8 py-3.5 bg-accent hover:bg-accent-hover text-foreground font-semibold rounded-xl transition-all hover:scale-105"
          >
            Get Started
          </Link>
          <Link
            to={ROUTES.LOGIN}
            className="px-8 py-3.5 border border-muted/30 text-foreground-base hover:border-accent hover:text-accent rounded-xl transition-all"
          >
            Sign In
          </Link>
        </div>

        {/* Supported sports badges */}
        <div className="flex flex-wrap justify-center gap-3 mb-16">
          {SUPPORTED_SPORTS.map((sport) => (
            <span
              key={sport.id}
              className="px-4 py-2 bg-surface border border-muted/20 rounded-full text-sm text-foreground-base"
            >
              {sport.label}
            </span>
          ))}
        </div>

        {/* Feature highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl w-full">
          <FeatureCard
            title="Live Scores"
            description="Real-time score updates streamed via WebSocket across all major sports leagues."
          />
          <FeatureCard
            title="Personalized Feed"
            description="Your saved teams always appear first. Content prioritized by your preferences."
          />
          <FeatureCard
            title="ML Predictions"
            description="Machine learning-powered win probability predictions for upcoming matchups."
          />
        </div>
      </header>

      <Footer />
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-surface border border-muted/20 rounded-xl p-6 text-left hover:border-accent/40 transition-colors">
      <h3 className="text-foreground font-semibold mb-2">{title}</h3>
      <p className="text-muted text-sm leading-relaxed">{description}</p>
    </div>
  );
}
