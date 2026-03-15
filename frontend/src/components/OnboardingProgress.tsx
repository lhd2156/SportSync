/**
 * SportSync - Onboarding Progress Indicator
 *
 * Step 1/2/3 progress bar shown at the top of all onboarding pages.
 * Filled steps use accent blue, future steps are muted.
 */
import { memo } from "react";

interface OnboardingProgressProps {
  currentStep: 1 | 2 | 3;
}

const STEPS = [
  { num: 1, label: "Profile" },
  { num: 2, label: "Sports" },
  { num: 3, label: "Teams" },
];

function OnboardingProgress({ currentStep }: OnboardingProgressProps) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.num} className="flex items-center gap-2 flex-1">
          {/* Step circle */}
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              step.num <= currentStep
                ? "bg-accent text-white"
                : "bg-surface border border-muted/20 text-muted"
            }`}
          >
            {step.num < currentStep ? "✓" : step.num}
          </div>
          <span
            className={`text-sm hidden sm:inline ${
              step.num <= currentStep ? "text-foreground" : "text-muted"
            }`}
          >
            {step.label}
          </span>
          {/* Connector line */}
          {i < STEPS.length - 1 && (
            <div
              className={`flex-1 h-0.5 rounded-full transition-colors ${
                step.num < currentStep ? "bg-accent" : "bg-muted/15"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default memo(OnboardingProgress);
