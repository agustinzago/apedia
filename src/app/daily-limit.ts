/** When a daily limit resets, as the Learner reads it: "in about 5 hours". */
export function untilReset(resetsAt: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 60_000));
  if (minutes === 1) return "in a minute";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

/** Apedia's spend for the day reached its alarm: sales pause, so no Course credit is sold. */
export function salesPausedNote(resumesAt: Date, now: Date = new Date()): string {
  return `Apedia is taking a breather today, come back tomorrow: new courses open again ${untilReset(resumesAt, now)}.`;
}

/** Apedia's spend for the day reached its stop: the Teacher is back when the day resets. */
export function breatherNote(resumesAt: Date, now: Date = new Date()): string {
  return `Apedia is taking a breather today, so your teacher is resting. Everything already written stays here to read, and your teacher is back ${untilReset(resumesAt, now)}.`;
}

/** A paused job's retry came before the day reset. */
export function stillPausedNote(resumesAt: Date, now: Date = new Date()): string {
  return `Your teacher is still taking a breather. Try again ${untilReset(resumesAt, now)}.`;
}

/** A job the spend stop paused: it picks up where it stopped once the day resets. */
export function pausedJobNote(resumesAt: Date, now: Date = new Date()): string {
  return resumesAt > now
    ? `Apedia is taking a breather today. Nothing is lost: this picks up where it stopped ${untilReset(resumesAt, now)}.`
    : "Apedia took a breather. Nothing is lost: this picks up where it stopped.";
}
