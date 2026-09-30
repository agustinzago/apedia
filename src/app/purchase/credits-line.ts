/**
 * How many unused Course credits the Learner holds, and how many of them an
 * Interview under way is keeping: "You have 2 Course credits, 1 kept for
 * your Interview under way."
 */
export function creditsLine(available: number, kept = 0): string {
  if (available === 0) return "You have no Course credits.";
  const line = `You have ${available} Course credit${available === 1 ? "" : "s"}`;
  if (kept === 0) return `${line}.`;
  const which = kept === available ? (available === 1 ? "" : " all") : ` ${kept}`;
  return `${line},${which} kept for your Interview${kept === 1 ? "" : "s"} under way.`;
}
