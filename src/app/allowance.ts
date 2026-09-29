/**
 * What the Learner reads once a Course's allowance (what its Course credit
 * buys) is used up. Calm: nothing is lost, and another Course keeps them going.
 */

/** Chat shows how many questions are left once fewer than this remain. */
export const SHOW_QUESTIONS_LEFT_BELOW = 20;

/** All the Course's Lessons are written: Up next stays, but won't be written here. */
export function lessonsUsedUpNote(allowance: number): string {
  return `That’s all ${allowance} Lessons this Course came with. Everything you’ve done stays here: your Lessons, Reference sheet and Learning records. To keep going, buy another Course and start it on a new Mission.`;
}

/** All the Course's chat questions are asked. */
export function questionsUsedUpNote(allowance: number): string {
  return `You’ve asked all ${allowance} questions this Course came with. Your Lessons and the answers so far stay here to read. To keep asking, buy another Course and start it on a new Mission.`;
}

/** "3 questions left in this Course". */
export function questionsLeftNote(left: number): string {
  return `${left} ${left === 1 ? "question" : "questions"} left in this Course`;
}
