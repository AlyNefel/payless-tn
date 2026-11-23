/**
 * "YYYY-MM-DD" of the visitor's own calendar day, `offset` days from today.
 * (toISOString() is UTC: in Tunisia between 00:00 and 01:00 it still returns yesterday.)
 */
export function localDay(offset = 0, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
