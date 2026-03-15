/**
 * SportSync - Privacy Policy Page
 *
 * GDPR and privacy regulation compliant privacy policy.
 */
import { Link } from "react-router-dom";
import Footer from "../components/Footer";
import Logo from "../components/Logo";
import { ROUTES } from "../constants";

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted mb-8">Last updated: March 14, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Information We Collect</h2>
            <p className="mb-3">We collect information you directly provide:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account Information:</strong> Email address, display name, date of birth, gender (optional), and profile picture</li>
              <li><strong>Authentication Data:</strong> Hashed passwords (bcrypt, cost 12) and Google OAuth tokens. We never store plaintext passwords.</li>
              <li><strong>Sport Preferences:</strong> Selected sports, saved teams, and onboarding choices</li>
              <li><strong>Usage Data:</strong> Pages visited, features used, and interaction patterns</li>
            </ul>
            <p className="mt-3">We automatically collect:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Device Information:</strong> Browser type, operating system, screen resolution</li>
              <li><strong>Network Data:</strong> IP address (used solely for rate limiting and security), request timestamps</li>
              <li><strong>Cookies:</strong> Essential session cookies and optional analytics cookies (see our <Link to={ROUTES.COOKIES} className="text-accent hover:underline">Cookie Policy</Link>)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Provide, maintain, and improve the Service</li>
              <li>Personalize your sports feed based on saved teams and selected sports</li>
              <li>Authenticate your identity and secure your account</li>
              <li>Send you essential account notifications (password resets, security alerts)</li>
              <li>Enforce our Terms of Service and prevent abuse (rate limiting, account lockout)</li>
              <li>Generate anonymized, aggregate analytics to improve the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Data Storage and Security</h2>
            <p className="mb-3">Your data is stored in PostgreSQL databases hosted on AWS (us-east-1 region). We implement the following security measures:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Passwords are hashed with bcrypt (cost factor 12) and never stored in plaintext</li>
              <li>JWTs are signed with HS256 and stored only in memory (never localStorage)</li>
              <li>Refresh tokens are sent as HTTP-only, Secure, SameSite=strict cookies</li>
              <li>All data in transit is encrypted via TLS 1.2+</li>
              <li>Rate limiting protects against brute-force attacks (10 login attempts per 15 minutes)</li>
              <li>Account lockout activates after 5 consecutive failed login attempts</li>
              <li>Redis caches are ephemeral and do not persist sensitive user data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Data Sharing</h2>
            <p>We do not sell, rent, or trade your personal information. We may share data with:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Service Providers:</strong> AWS (hosting), Google (OAuth authentication), TheSportsDB (sports data)</li>
              <li><strong>Legal Requirements:</strong> When required by law, subpoena, or government request</li>
              <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Your Rights</h2>
            <p className="mb-3">Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
              <li><strong>Rectification:</strong> Update or correct inaccurate personal data via Settings</li>
              <li><strong>Deletion:</strong> Request deletion of your account and associated data</li>
              <li><strong>Portability:</strong> Receive your data in a structured, machine-readable format</li>
              <li><strong>Withdraw Consent:</strong> Opt out of non-essential cookies at any time via the Cookie Settings</li>
            </ul>
            <p className="mt-3">To exercise these rights, contact us at privacy@sportsync.app.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Data Retention</h2>
            <p>We retain your account data for as long as your account is active. Login sessions expire after 7 days (or 30 days with Remember Me). Upon account deletion, we remove your personal data within 30 days, except where retention is required by law. Anonymized analytics data may be retained indefinitely.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Children's Privacy</h2>
            <p>SportSync is not intended for users under 18 years of age. We do not knowingly collect personal information from anyone under 18. If we become aware that a user is under 18, we will promptly terminate the account and delete any associated data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of significant changes by posting a prominent notice on the Service. Your continued use of the Service after changes constitutes acceptance of the updated policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. Contact</h2>
            <p>For privacy-related questions or to exercise your data rights, contact us at privacy@sportsync.app.</p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
