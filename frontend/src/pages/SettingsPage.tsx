/**
 * SportSync - Settings Page
 *
 * User profile editing: display name, gender, profile picture.
 * Google users can set a password for email login.
 */
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API } from "../constants";

export default function SettingsPage() {
  const { user, setUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMessage("");
    setIsSaving(true);

    try {
      await apiClient.put(API.USER_PROFILE, {
        display_name: displayName,
        gender: gender || null,
      });
      if (user) {
        setUser({ ...user, displayName, gender: gender || null });
      }
      setProfileMessage("Profile updated!");
    } catch {
      setProfileMessage("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMessage("");

    if (newPassword.length < 8) {
      setPasswordMessage("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("Passwords do not match.");
      return;
    }

    try {
      await apiClient.post("/api/auth/set-password", {
        password: newPassword,
        confirm_password: confirmPassword,
      });
      setPasswordMessage("Password set successfully!");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMessage("Failed to set password.");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-8">Settings</h1>

        {/* Profile section */}
        <section className="bg-surface border border-muted/20 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Profile</h2>
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-sm text-foreground-base mb-1.5">Email</label>
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="w-full bg-background/50 border border-muted/20 text-muted rounded-lg px-4 py-2.5 cursor-not-allowed"
              />
            </div>

            <div>
              <label htmlFor="settings-name" className="block text-sm text-foreground-base mb-1.5">
                Display Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="settings-gender" className="block text-sm text-foreground-base mb-1.5">
                Gender
              </label>
              <select
                id="settings-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
              >
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
                <option value="other">Other</option>
              </select>
            </div>

            {profileMessage && (
              <p className={`text-sm ${profileMessage.includes("Failed") ? "text-red-400" : "text-green-400"}`}>
                {profileMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-foreground font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </section>

        {/* Password section */}
        <section className="bg-surface border border-muted/20 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Password</h2>
          <p className="text-muted text-sm mb-4">
            Set a password to also sign in with email (useful for Google users).
          </p>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label htmlFor="settings-pw" className="block text-sm text-foreground-base mb-1.5">
                New Password
              </label>
              <input
                id="settings-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="settings-confirm" className="block text-sm text-foreground-base mb-1.5">
                Confirm Password
              </label>
              <input
                id="settings-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
              />
            </div>

            {passwordMessage && (
              <p className={`text-sm ${passwordMessage.includes("Failed") || passwordMessage.includes("must") || passwordMessage.includes("match") ? "text-red-400" : "text-green-400"}`}>
                {passwordMessage}
              </p>
            )}

            <button
              type="submit"
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-foreground font-medium rounded-lg transition-colors"
            >
              Set Password
            </button>
          </form>
        </section>
      </main>

      <Footer />
    </div>
  );
}
