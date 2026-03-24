/**
 * SportSync - AgeGate Component
 *
 * Inline error shown when date of birth is under 18.
 * Blocks form submission. Per blueprint Section 9.
 */
import { memo } from "react";

type AgeGateProps = {
  dateOfBirth: string;
};

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function AgeGate({ dateOfBirth }: AgeGateProps) {
  if (!dateOfBirth) return null;

  const age = calculateAge(dateOfBirth);
  if (age >= 18) return null;

  return (
    <div className="surface-error-card rounded-lg px-4 py-3">
      <p className="surface-status-negative text-sm font-medium">
        You must be 18 or older to use SportSync.
      </p>
      <p className="surface-status-negative text-xs mt-0.5 opacity-75">
        Based on the date entered, you are {age} years old.
      </p>
    </div>
  );
}

export { calculateAge };
export default memo(AgeGate);
