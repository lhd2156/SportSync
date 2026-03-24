/**
 * SportSync - Date of Birth Utilities
 *
 * Smart parsing that handles multiple input formats:
 *   04302004  → 2004-04-30
 *   4302004   → 2004-04-30
 *   04/30/2004 → 2004-04-30
 *   4/30/2004  → 2004-04-30
 *   04-30-2004 → 2004-04-30
 *   2004-04-30 → 2004-04-30 (ISO passthrough)
 *   01/152000  → 2000-01-15  (missing slash edge case)
 */

export function parseDobInput(raw: string): string {
  // Already a valid ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Strip everything except digits
  const digits = raw.replace(/\D/g, "");

  let month = "";
  let day = "";
  let year = "";

  if (digits.length === 8) {
    // MMDDYYYY — most common
    month = digits.slice(0, 2);
    day = digits.slice(2, 4);
    year = digits.slice(4, 8);
  } else if (digits.length === 7) {
    // Could be MDDYYYY (e.g., 4302004) or MMDYYYY (e.g., 1232004)
    // Try MDDYYYY first (single-digit month)
    const m1 = Number(digits.slice(0, 1));
    const d1 = Number(digits.slice(1, 3));
    if (m1 >= 1 && m1 <= 9 && d1 >= 1 && d1 <= 31) {
      month = String(m1).padStart(2, "0");
      day = String(d1).padStart(2, "0");
      year = digits.slice(3, 7);
    } else {
      // Try MMDYYYY (single-digit day)
      const m2 = Number(digits.slice(0, 2));
      const d2 = Number(digits.slice(2, 3));
      if (m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 9) {
        month = String(m2).padStart(2, "0");
        day = String(d2).padStart(2, "0");
        year = digits.slice(3, 7);
      } else {
        return "";
      }
    }
  } else if (digits.length === 6) {
    // Could be MDYYYY (e.g., 132004 for 1/3/2004)
    const m1 = Number(digits.slice(0, 1));
    const d1 = Number(digits.slice(1, 2));
    const y1 = digits.slice(2, 6);
    if (m1 >= 1 && m1 <= 9 && d1 >= 1 && d1 <= 9 && Number(y1) >= 1900) {
      month = String(m1).padStart(2, "0");
      day = String(d1).padStart(2, "0");
      year = y1;
    } else {
      return "";
    }
  } else {
    return "";
  }

  // Validate ranges
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return "";

  // Validate day for month (rough check)
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d > daysInMonth) return "";

  return `${year}-${month}-${day}`;
}

export function formatDobDisplay(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

/**
 * Auto-format as user types: insert slashes automatically.
 * Handles edge cases like:
 *   "01152000" → "01/15/2000"
 *   "01/152000" → "01/15/2000" (missing second slash)
 *   "1/152000" → "1/15/2000"  (single digit month with missing slash)
 */
export function autoFormatDobText(val: string): string {
  // Count existing slashes
  const slashCount = (val.match(/\//g) || []).length;

  // If user typed two slashes already, respect their formatting
  if (slashCount >= 2) return val;

  // If there's exactly one slash, check if the part after the slash is too long
  // e.g. "01/152000" should become "01/15/2000"
  if (slashCount === 1) {
    const parts = val.split("/");
    const afterSlash = parts[1];
    // If after-slash part has more than 2 digits and no second slash
    // and the total digits look like DDYYYY, insert a slash
    if (afterSlash.length > 2) {
      const afterDigits = afterSlash.replace(/\D/g, "");
      if (afterDigits.length >= 3) {
        return `${parts[0]}/${afterDigits.slice(0, 2)}/${afterDigits.slice(2, 6)}`;
      }
    }
    return val;
  }

  // If there's a dash, it might be ISO or dash-separated — leave it
  if (val.includes("-")) return val;

  // Pure digits — auto-insert slashes as they type
  const digits = val.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}
