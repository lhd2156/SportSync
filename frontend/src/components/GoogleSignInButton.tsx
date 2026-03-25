/**
 * SportSync - Google Sign-In Button
 *
 * Uses the Google Identity Services (GIS) SDK to render a
 * "Sign in with Google" popup and sends the resulting ID token
 * to the backend for verification.
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_ALLOWED_ORIGINS = String(import.meta.env.VITE_GOOGLE_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function getCurrentOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.origin;
}

function googleSignInAllowedForCurrentOrigin(): boolean {
  if (!GOOGLE_CLIENT_ID) {
    return false;
  }

  const currentOrigin = getCurrentOrigin();
  if (!currentOrigin) {
    return false;
  }

  return GOOGLE_ALLOWED_ORIGINS.includes(currentOrigin);
}

export const GOOGLE_SIGN_IN_AVAILABLE = googleSignInAllowedForCurrentOrigin();

type Props = {
  /** Text on the button label — "signin_with" or "continue_with" */
  text?: "signin_with" | "continue_with";
};

export default function GoogleSignInButton({ text = "continue_with" }: Props) {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const [error, setError] = useState("");
  const googleSignInEnabled = googleSignInAllowedForCurrentOrigin();

  const handleCredentialResponse = useCallback(
    async (response: { credential: string }) => {
      setError("");
      try {
        await loginWithGoogle(response.credential);
        // loginWithGoogle sets the user in AuthContext; read it after await
        // The auth context user will be updated by the time we navigate,
        // but we can't read it synchronously here. Instead, we rely on the
        // ProtectedRoute: navigate to dashboard and let the guard redirect
        // to onboarding if the user hasn't completed it yet.
        navigate(ROUTES.DASHBOARD);
      } catch {
        setError("Google sign-in failed. Please try again.");
      }
    },
    [loginWithGoogle, navigate],
  );

  useEffect(() => {
    if (!googleSignInEnabled || initializedRef.current) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && buttonRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "pill",
          width: buttonRef.current.offsetWidth,
        });
        initializedRef.current = true;
      }
    };
    document.head.appendChild(script);

    return () => {
      // Don't remove the script on unmount — GIS doesn't like that
    };
  }, [googleSignInEnabled, handleCredentialResponse, text]);

  // Fallback button when GIS hasn't loaded yet
  if (!googleSignInEnabled) {
    return null;
  }

  return (
    <div className="w-full">
      <div ref={buttonRef} className="w-full flex justify-center" />
      {error ? (
        <p className="surface-status-negative mt-2 text-center text-sm">{error}</p>
      ) : null}
    </div>
  );
}
