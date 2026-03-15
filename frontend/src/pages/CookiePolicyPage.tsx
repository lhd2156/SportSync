/**
 * SportSync - Cookie Policy Page
 *
 * Explains what cookies are used, why, and how to manage preferences.
 */
import { Link } from "react-router-dom";
import Footer from "../components/Footer";
import { ROUTES } from "../constants";

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground-base">
      <header className="border-b border-muted/20 py-4 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to={ROUTES.HOME} className="text-xl font-bold text-accent">SportSync</Link>
          <Link to={ROUTES.HOME} className="text-sm text-muted hover:text-foreground transition-colors">
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-foreground mb-2">Cookie Policy</h1>
        <p className="text-sm text-muted mb-8">Last updated: March 14, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">What Are Cookies?</h2>
            <p>Cookies are small text files stored on your device when you visit a website. They help the site remember your preferences, maintain your session, and improve your experience. SportSync uses both session cookies (which expire when you close your browser) and persistent cookies (which remain until they expire or you delete them).</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Cookies We Use</h2>

            <div className="bg-surface border border-muted/20 rounded-lg overflow-hidden mt-4">
              <table className="w-full text-left">
                <thead className="border-b border-muted/20">
                  <tr>
                    <th className="px-4 py-3 text-foreground font-medium">Cookie</th>
                    <th className="px-4 py-3 text-foreground font-medium">Type</th>
                    <th className="px-4 py-3 text-foreground font-medium">Purpose</th>
                    <th className="px-4 py-3 text-foreground font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-muted/10">
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">refresh_token</td>
                    <td className="px-4 py-3"><span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded text-xs">Essential</span></td>
                    <td className="px-4 py-3">Maintains your authenticated session securely (HTTP-only, Secure, SameSite=strict)</td>
                    <td className="px-4 py-3">7 days</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">session_token</td>
                    <td className="px-4 py-3"><span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded text-xs">Essential</span></td>
                    <td className="px-4 py-3">Enables "Remember Me" functionality for persistent login</td>
                    <td className="px-4 py-3">30 days</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">cookie_consent</td>
                    <td className="px-4 py-3"><span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded text-xs">Essential</span></td>
                    <td className="px-4 py-3">Stores your cookie consent preferences</td>
                    <td className="px-4 py-3">365 days</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">preferences</td>
                    <td className="px-4 py-3"><span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs">Functional</span></td>
                    <td className="px-4 py-3">Remembers UI preferences (theme, last viewed sport tab)</td>
                    <td className="px-4 py-3">365 days</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">analytics</td>
                    <td className="px-4 py-3"><span className="bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded text-xs">Analytics</span></td>
                    <td className="px-4 py-3">Anonymized usage metrics to help improve the Service</td>
                    <td className="px-4 py-3">90 days</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Managing Your Preferences</h2>
            <p className="mb-3">You can manage your cookie preferences at any time:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Cookie Banner:</strong> When you first visit SportSync, a banner lets you accept all cookies or customize your preferences</li>
              <li><strong>Cookie Settings:</strong> You can change your preferences at any time by clicking "Cookie Settings" in the footer</li>
              <li><strong>Browser Settings:</strong> Most browsers allow you to block or delete cookies through their settings. Note that blocking essential cookies may prevent the Service from functioning properly.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Essential Cookies</h2>
            <p>Essential cookies are required for the Service to function and cannot be disabled. They include the authentication cookies (refresh_token, session_token) that keep you signed in and the cookie_consent cookie that remembers your preferences. Without these cookies, you would not be able to use SportSync.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Third-Party Cookies</h2>
            <p>SportSync does not use third-party advertising cookies. If you sign in with Google, Google's authentication service may set cookies according to their own cookie policy. We do not control these cookies and recommend reviewing Google's privacy policy for more information.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
            <p>For questions about our cookie practices, contact us at privacy@sportsync.app.</p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
