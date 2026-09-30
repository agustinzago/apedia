/** Pure, with no database, so client components can import it. */

/** Longest a subject shows inside a sentence, in characters. */
const SHORT_SUBJECT = 40;

/**
 * The subject as it reads inside a sentence: past SHORT_SUBJECT characters,
 * cut at a word and ended with "…". The Teacher still gets it whole.
 */
export function shortSubject(subject: string): string {
  if (subject.length <= SHORT_SUBJECT) return subject;
  const cut = subject.slice(0, SHORT_SUBJECT);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > SHORT_SUBJECT / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}
