/**
 * SportSync - Settings Page
 *
 * Sections: Profile, Sport Preferences, Password, Account.
 * Google users can set a password for email login.
 */
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API, SUPPORTED_SPORTS } from "../constants";

export default function SettingsPage() {
  const { user, setUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSports, setSelectedSports] = useState<string[]>(
    user?.sports || SUPPORTED_SPORTS.map((s) => s.id)
  );

  function toggleSport(id: string) {
    setSelectedSports((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg("");
    setIsSaving(true);
    try {
      await apiClient.put(API.USER_PROFILE, {
        display_name: displayName,
        gender: gender || null,
        sports: selectedSports,
      });
      if (user) {
        setUser({ ...user, displayName, gender: gender || null, sports: selectedSports });
      }
      setProfileMsg("Saved");
    } catch {
      setProfileMsg("Failed to save.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    if (newPassword.length < 8) { setPwMsg("Min 8 characters."); return; }
    if (newPassword !== confirmPassword) { setPwMsg("Passwords don't match."); return; }
    try {
      await apiClient.post("/api/auth/set-password", {
        password: newPassword,
        confirm_password: confirmPassword,
      });
      setPwMsg("Password set.");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPwMsg("Failed.");
    }
  }

  const inputCls = "w-full bg-surface border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/50";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>

        {/* Profile */}
        <section className="bg-surface border border-muted/15 rounded-xl p-6">
          <h2 className="text-foreground font-medium mb-4">Profile</h2>
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-sm text-muted mb-1">Email</label>
              <input type="email" value={user?.email || ""} disabled className="w-full bg-surface border border-muted/10 text-muted/60 rounded-lg px-4 py-2.5 cursor-not-allowed" />
            </div>
            <div>
              <label htmlFor="s-name" className="block text-sm text-foreground-base mb-1">Display Name</label>
              <input id="s-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="s-gender" className="block text-sm text-foreground-base mb-1">Gender</label>
              <select id="s-gender" value={gender} onChange={(e) => setGender(e.target.value)} className={inputCls}>
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Sport Preferences */}
            <div>
              <label className="block text-sm text-foreground-base mb-2">Sport Preferences</label>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_SPORTS.map((sport) => (
                  <button
                    key={sport.id}
                    type="button"
                    onClick={() => toggleSport(sport.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selectedSports.includes(sport.id)
                        ? "bg-accent text-white"
                        : "bg-background border border-muted/20 text-muted hover:text-foreground"
                    }`}
                  >
                    {sport.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
              {profileMsg && (
                <span className={`text-sm ${profileMsg.includes("Failed") ? "text-red-400" : "text-green-400"}`}>
                  {profileMsg}
                </span>
              )}
            </div>
          </form>
        </section>

        {/* Password */}
        <section className="bg-surface border border-muted/15 rounded-xl p-6">
          <h2 className="text-foreground font-medium mb-1">Password</h2>
          <p className="text-muted text-sm mb-4">Set a password to also sign in with email.</p>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label htmlFor="s-pw" className="block text-sm text-foreground-base mb-1">New Password</label>
              <input id="s-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} placeholder="At least 8 characters" />
            </div>
            <div>
              <label htmlFor="s-cpw" className="block text-sm text-foreground-base mb-1">Confirm Password</label>
              <input id="s-cpw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors">
                Set Password
              </button>
              {pwMsg && (
                <span className={`text-sm ${pwMsg.includes("Failed") || pwMsg.includes("Min") || pwMsg.includes("match") ? "text-red-400" : "text-green-400"}`}>
                  {pwMsg}
                </span>
              )}
            </div>
          </form>
        </section>

        {/* Account info */}
        <section className="bg-surface border border-muted/15 rounded-xl p-6">
          <h2 className="text-foreground font-medium mb-3">Account</h2>
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted">Auth Provider</span>
              <span className="text-foreground-base">{user?.provider === "google" ? "Google" : "Email"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Member since</span>
              <span className="text-foreground-base">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
              </span>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
