/**
 * SportSync - Landing Page
 *
 * Public marketing page. Hero fills the viewport.
 * Sports badges and features visible on scroll.
 */
import { Link, Navigate } from "react-router-dom";
import { ROUTES, SUPPORTED_SPORTS } from "../constants";
import { useAuth } from "../context/AuthContext";
import Logo from "../components/Logo";
import Footer from "../components/Footer";

export default function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();

  /* Authenticated users should see the dashboard, not the marketing page */
  if (!isLoading && isAuthenticated) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return (
    <div className="bg-background text-foreground">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 bg-background/80 backdrop-blur-md border-b border-muted/10">
        <Logo size="sm" linkTo={null} />
        <div className="flex items-center gap-2">
          <Link
            to={ROUTES.LOGIN}
            className="px-4 py-2 text-sm text-foreground-base hover:text-foreground transition-colors"
          >
            Sign In
          </Link>
          <Link
            to={ROUTES.REGISTER}
            className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero — fills entire viewport */}
      <header className="min-h-screen flex flex-col items-center justify-center px-6 pt-16 text-center">
        <img src="/favicon.svg" alt="SportSync" className="w-16 h-16 mb-6" />
        <h1 className="text-5xl sm:text-6xl font-bold mb-4 tracking-tight">
          <span className="text-accent">Sport</span>
          <span className="text-foreground">Sync</span>
        </h1>
        <p className="text-lg text-muted max-w-lg mx-auto leading-relaxed mb-8">
          Live scores, personalized feeds, and ML-powered predictions across NFL, NBA, MLB, NHL, and EPL.
        </p>
        <div className="flex gap-3">
          <Link
            to={ROUTES.REGISTER}
            className="px-8 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-accent/20"
          >
            Get Started
          </Link>
          <Link
            to={ROUTES.LOGIN}
            className="px-8 py-3 border border-muted/20 text-foreground-base hover:border-accent/40 hover:text-foreground rounded-lg transition-all"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Below fold — sports + features */}
      <section className="py-16 px-6">
        <div className="flex flex-wrap justify-center gap-2 mb-16 max-w-2xl mx-auto">
          {SUPPORTED_SPORTS.map((sport) => (
            <span
              key={sport.id}
              className="px-4 py-1.5 bg-surface border border-muted/15 rounded-full text-sm text-foreground-base"
            >
              {sport.label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          <FeatureCard
            title="Live Scores"
            description="Real-time score updates via WebSocket. Sub-second latency across all leagues."
          />
          <FeatureCard
            title="Personalized Feed"
            description="Saved teams first. Your sports, your leagues, your experience."
          />
          <FeatureCard
            title="ML Predictions"
            description="Win probability powered by Random Forest models trained on historical data."
          />
        </div>
      </section>

      <Footer />
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-surface border border-muted/15 rounded-xl p-6 hover:border-accent/30 transition-colors">
      <h3 className="text-foreground font-medium mb-2">{title}</h3>
      <p className="text-muted text-sm leading-relaxed">{description}</p>
    </div>
  );
}
