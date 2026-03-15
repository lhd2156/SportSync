/**
 * SportSync - Age Validation Utility
 *
 * Calculates age from a date of birth string and checks minimum age.
 * Used in onboarding step 1 to enforce 18+ requirement on the frontend.
 * The backend also enforces this independently.
 */
import { MINIMUM_AGE_YEARS } from "../constants";

/**
 * Calculate age in full years from a date of birth.
 * Accounts for whether the birthday has occurred this year.
 */
export function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();

  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  /* If birthday has not happened yet this year, subtract one */
  const birthdayNotYetThisYear =
    monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate());

  if (birthdayNotYetThisYear) {
    age -= 1;
  }

  return age;
}

/**
 * Check whether a person meets the minimum age requirement.
 */
export function isOldEnough(dateOfBirth: string): boolean {
  return calculateAge(dateOfBirth) >= MINIMUM_AGE_YEARS;
}
