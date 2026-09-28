/** How many unused Course credits the Learner holds: "You have 2 Course credits." */
export function creditsLine(available: number): string {
  if (available === 0) return "You have no Course credits.";
  return `You have ${available} Course credit${available === 1 ? "" : "s"}.`;
}
