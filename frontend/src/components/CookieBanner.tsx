/**
 * SportSync - Cookie Consent Banner
 *
 * Fixed banner at the bottom of the screen shown before the user
 * accepts cookies. Links to Cookie Policy. Offers Accept All or
 * Manage Preferences options.
 */
import { useState } from "react";
import { useCookieConsent } from "../context/CookieContext";
import CookieModal from "./CookieModal";

export default function CookieBanner() {
  const { showBanner, acceptAll } = useCookieConsent();
  const [showModal, setShowModal] = useState(false);

  if (!showBanner) return null;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-muted/20 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-foreground-base text-sm leading-relaxed">
            SportSync uses cookies to keep you logged in and improve your experience.
            By continuing, you agree to our{" "}
            <a href="/cookies" className="text-accent hover:text-accent-hover underline">
              Cookie Policy
            </a>.
          </p>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 text-sm text-muted hover:text-foreground border border-muted/30 rounded-lg transition-colors"
            >
              Manage Preferences
            </button>
            <button
              onClick={acceptAll}
              className="px-6 py-2 text-sm font-medium text-foreground bg-accent hover:bg-accent-hover rounded-lg transition-colors"
            >
              Accept All
            </button>
          </div>
        </div>
      </div>

      {showModal && <CookieModal onClose={() => setShowModal(false)} />}
    </>
  );
}
