/**
 * SportSync - Onboarding Step 1: About You
 *
 * Collects: First Name, Last Name, Display Name (@handle style),
 * Date of Birth (smart parsing + calendar), Gender (optional).
 * Google-signed-in users get display name pre-filled from their profile.
 * Inline red validation — no browser tooltip popups.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";
import { isOldEnough } from "../utils/age";

import { parseDobInput, formatDobDisplay, autoFormatDobText } from "../utils/dob";


export default function OnboardingStep1() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [dobDisplay, setDobDisplay] = useState("");
  const [dobIso, setDobIso] = useState("");
  const [gender, setGender] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleDobTextChange(val: string) {
    const formatted = autoFormatDobText(val);
    setDobDisplay(formatted);
    // Try to parse
    const parsed = parseDobInput(formatted);
    if (parsed) {
      setDobIso(parsed);
      setErrors((e) => ({ ...e, dob: "" }));
    } else {
      setDobIso("");
    }
  }

  function handleDobCalendarChange(val: string) {
    setDobIso(val);
    setDobDisplay(formatDobDisplay(val));
    setErrors((e) => ({ ...e, dob: "" }));
  }

  function handleDisplayNameChange(val: string) {
    // Make it IG-handle style: lowercase, no spaces, alphanumeric + underscores + dots
    const cleaned = val.toLowerCase().replace(/[^a-z0-9._]/g, "");
    setDisplayName(cleaned);
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = "First name is required";
    if (!lastName.trim()) errs.lastName = "Last name is required";
    if (!displayName.trim()) errs.displayName = "Display name is required";
    if (displayName.length < 3) errs.displayName = "At least 3 characters";
    if (!dobIso) errs.dob = "Enter a valid date (e.g. 04301999)";
    else if (!isOldEnough(dobIso)) errs.dob = "You must be 18 or older";
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setIsSubmitting(true);
    try {
      await apiClient.post(API.ONBOARDING_STEP_1, {
        date_of_birth: dobIso,
        display_name: displayName,
        gender: gender || null,
      });

      if (user) {
        setUser({
          ...user,
          displayName,
          dateOfBirth: dobIso,
          gender: gender || null,
        });
      }

      navigate(ROUTES.ONBOARDING_STEP_2);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setErrors({ api: apiError.response?.data?.detail || "Failed to save. Try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputBase =
    "w-full bg-background border text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/40";
  const inputOk = `${inputBase} border-muted/20`;
const inputErr = `${inputBase} border-[color:var(--danger-strong)]/60`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12 animate-fadeIn">
      <div className="w-full max-w-md">
        {/* Progress indicator */}
        <OnboardingProgress currentStep={1} />

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">About You</h1>
          <p className="text-muted text-sm">Tell us a bit about yourself</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="bg-surface border border-muted/15 rounded-2xl p-6 shadow-lg shadow-black/20 space-y-4">
          {errors.api && (
          <div className="surface-error-card text-sm rounded-lg px-4 py-3">
              {errors.api}
            </div>
          )}

          {/* First Name + Last Name — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="onb-first" className="block text-sm text-muted mb-1">
                First Name
              </label>
              <input
                id="onb-first"
                type="text"
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); setErrors((p) => ({ ...p, firstName: "" })); }}
                className={errors.firstName ? inputErr : inputOk}
                placeholder="First"
              />
            {errors.firstName && <p className="surface-status-negative text-xs mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label htmlFor="onb-last" className="block text-sm text-muted mb-1">
                Last Name
              </label>
              <input
                id="onb-last"
                type="text"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); setErrors((p) => ({ ...p, lastName: "" })); }}
                className={errors.lastName ? inputErr : inputOk}
                placeholder="Last"
              />
            {errors.lastName && <p className="surface-status-negative text-xs mt-1">{errors.lastName}</p>}
            </div>
          </div>

          {/* Display Name — IG handle style */}
          <div>
            <label htmlFor="onb-handle" className="block text-sm text-muted mb-1">
              Display Name <span className="text-muted/50">(@handle)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50 text-sm select-none">@</span>
              <input
                id="onb-handle"
                type="text"
                value={displayName}
                onChange={(e) => { handleDisplayNameChange(e.target.value); setErrors((p) => ({ ...p, displayName: "" })); }}
                className={`${errors.displayName ? inputErr : inputOk} pl-7`}
                placeholder="your_handle"
              />
            </div>
            {errors.displayName && <p className="surface-status-negative text-xs mt-1">{errors.displayName}</p>}
          </div>

          {/* Date of Birth — text input with inline calendar */}
          <div>
            <label htmlFor="onb-dob" className="block text-sm text-muted mb-1">
              Date of Birth
            </label>
            <div className="relative">
              <input
                id="onb-dob"
                type="text"
                value={dobDisplay}
                onChange={(e) => handleDobTextChange(e.target.value)}
                className={`${errors.dob ? inputErr : inputOk} pr-11`}
                placeholder="MM/DD/YYYY"
              />
              <div className="absolute right-0 top-0 h-full flex items-center pr-2">
                <input
                  type="date"
                  value={dobIso}
                  onChange={(e) => handleDobCalendarChange(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  tabIndex={-1}
                />
                <svg className="w-5 h-5 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            {errors.dob ? (
          <p className="surface-status-negative text-xs mt-1">{errors.dob}</p>
            ) : (
              <p className="text-xs text-muted/50 mt-1">You must be 18 or older to use SportSync</p>
            )}
          </div>

          {/* Gender */}
          <div>
            <label htmlFor="onb-gender" className="block text-sm text-muted mb-1">
              Gender <span className="text-muted/50">(optional)</span>
            </label>
            <select
              id="onb-gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={inputOk}
            >
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

function OnboardingProgress({ currentStep }: { currentStep: number }) {
  const steps = [1, 2, 3];
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step) => (
        <div
          key={step}
          className={`w-10 h-1.5 rounded-full transition-colors ${
            step <= currentStep ? "bg-accent" : "bg-muted/30"
          }`}
        />
      ))}
    </div>
  );
}
