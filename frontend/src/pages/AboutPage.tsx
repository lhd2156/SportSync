/**
 * SportSync - About Page
 *
 * Platform information, version, and credits.
 */
import { Link } from "react-router-dom";
import Footer from "../components/Footer";
import Logo from "../components/Logo";
import { ROUTES, APP_VERSION } from "../constants";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground-base">
      <header className="border-b border-muted/20 py-4 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <Link to={ROUTES.HOME} className="text-sm text-muted hover:text-foreground transition-colors">
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-foreground mb-8">About SportSync</h1>

        <div className="space-y-8 text-sm leading-relaxed">
          <section className="bg-surface border border-muted/20 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-3">What is SportSync?</h2>
            <p>SportSync is a real-time multi-sport platform that brings live scores, game schedules, team data, and machine learning predictions together in one personalized experience. Follow the teams you love across NFL, NBA, MLB, NHL, and EPL.</p>
          </section>

          <section className="bg-surface border border-muted/20 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-3">Features</h2>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5 font-bold">--</span>
                <span><strong>Real-Time Scores:</strong> Live score updates via WebSocket with sub-second latency</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5 font-bold">--</span>
                <span><strong>Personalized Feed:</strong> Your saved teams always appear first, followed by their leagues, your sports, then explore</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5 font-bold">--</span>
                <span><strong>ML Predictions:</strong> Win probability predictions powered by Random Forest models trained on historical data</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5 font-bold">--</span>
                <span><strong>Privacy-First:</strong> JWTs stored in memory only, HTTP-only cookies, bcrypt hashing, and full cookie consent management</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5 font-bold">--</span>
                <span><strong>5 Sports Supported:</strong> NFL, NBA, MLB, NHL, and English Premier League</span>
              </li>
            </ul>
          </section>

          <section className="bg-surface border border-muted/20 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-3">Technology Stack</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-foreground font-medium mb-1">Frontend</h3>
                <p className="text-muted">React, TypeScript, Vite, Tailwind CSS v4, React Query</p>
              </div>
              <div>
                <h3 className="text-foreground font-medium mb-1">Backend API</h3>
                <p className="text-muted">Python, FastAPI, SQLAlchemy, PostgreSQL, Redis</p>
              </div>
              <div>
                <h3 className="text-foreground font-medium mb-1">Realtime</h3>
                <p className="text-muted">Go, Gin, Gorilla WebSocket, Redis Pub/Sub</p>
              </div>
              <div>
                <h3 className="text-foreground font-medium mb-1">ML Pipeline</h3>
                <p className="text-muted">Pandas, NumPy, scikit-learn (Random Forest)</p>
              </div>
            </div>
          </section>

          <section className="bg-surface border border-muted/20 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-3">Data Sources</h2>
            <p>Sports data is provided by <a href="https://www.thesportsdb.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">TheSportsDB</a>, a community-driven sports data API. Team logos and league names are trademarks of their respective owners.</p>
          </section>

          <section className="bg-surface border border-muted/20 rounded-xl p-6 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Version</h2>
              <p className="text-muted">SportSync {APP_VERSION}</p>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-semibold text-foreground">Built by</h2>
              <p className="text-muted">Louis Do</p>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
