/**
 * SportSync - Cookie Preferences Modal
 *
 * Shows toggleable categories: Essential (always on), Functional
 * (default on), Analytics (default off). Users save their preferences
 * and the modal closes.
 */
import { useState } from "react";
import { useCookieConsent } from "../context/CookieContext";
import type { CookiePreferences } from "../types";

interface CookieModalProps {
  onClose: () => void;
}

export default function CookieModal({ onClose }: CookieModalProps) {
  const { preferences, savePreferences } = useCookieConsent();
  const [localPrefs, setLocalPrefs] = useState<CookiePreferences>(preferences);

  function handleSave() {
    savePreferences(localPrefs);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-xl border border-muted/20 p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Cookie Preferences
        </h2>

        <div className="space-y-4 mb-6">
          {/* Essential cookies -- always on */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm font-medium">Essential</p>
              <p className="text-muted text-xs">Auth sessions, security. Always active.</p>
            </div>
            <div className="w-10 h-5 bg-accent rounded-full relative cursor-not-allowed">
              <div className="w-4 h-4 bg-foreground rounded-full absolute right-0.5 top-0.5" />
            </div>
          </div>

          {/* Functional cookies */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm font-medium">Functional</p>
              <p className="text-muted text-xs">Remember Me, theme preferences.</p>
            </div>
            <button
              onClick={() => setLocalPrefs((p) => ({ ...p, functional: !p.functional }))}
              className={`w-10 h-5 rounded-full relative transition-colors ${
                localPrefs.functional ? "bg-accent" : "bg-muted/30"
              }`}
            >
              <div
                className={`w-4 h-4 bg-foreground rounded-full absolute top-0.5 transition-all ${
                  localPrefs.functional ? "right-0.5" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {/* Analytics cookies */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm font-medium">Analytics</p>
              <p className="text-muted text-xs">Usage tracking for future improvements.</p>
            </div>
            <button
              onClick={() => setLocalPrefs((p) => ({ ...p, analytics: !p.analytics }))}
              className={`w-10 h-5 rounded-full relative transition-colors ${
                localPrefs.analytics ? "bg-accent" : "bg-muted/30"
              }`}
            >
              <div
                className={`w-4 h-4 bg-foreground rounded-full absolute top-0.5 transition-all ${
                  localPrefs.analytics ? "right-0.5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 text-sm font-medium text-foreground bg-accent hover:bg-accent-hover rounded-lg transition-colors"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
