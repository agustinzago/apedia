/** The longest subject `course` takes. */
const MAX_SUBJECT = 120;

/**
 * The subject a visitor typed on the home page, as it rides along in URLs
 * through sign-in and checkout: untrusted text, so control characters are
 * dropped, a word repeated in a row is kept once ("chess chess chess" is
 * "chess"), and it is cut to length. Empty when there is none.
 */
export function typedSubject(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/(?<!\p{L})(\p{L}+)(?:\s+\1(?!\p{L}))+/giu, "$1")
    .trim()
    .slice(0, MAX_SUBJECT)
    .trim();
}

/** Where a new Interview on the subject starts; sign-in and checkout come back here. */
export function interviewPath(subject: string): string {
  return `/interview?${new URLSearchParams({ subject })}`;
}

/** The subject a path made by `interviewPath` carries, or "" for any other path. */
export function subjectIn(path: string): string {
  if (!path.startsWith("/interview?")) return "";
  return typedSubject(new URLSearchParams(path.slice("/interview?".length)).get("subject"));
}

/** An Interview already under way. */
export function openInterviewPath(interviewId: string): string {
  return `/interview?${new URLSearchParams({ id: interviewId })}`;
}
