/** When a daily limit resets, as the Learner reads it: "in about 5 hours". */
export function untilReset(resetsAt: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 60_000));
  if (minutes === 1) return "in a minute";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}
