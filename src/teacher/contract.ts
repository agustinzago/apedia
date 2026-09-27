import { z } from "zod";

/** What the Teacher is asked and what it answers: typed inputs, zod-validated outputs. */

export const SafetyVerdict = z.object({
  verdict: z.enum(["allow", "redirect"]),
  /** BCP 47 tag of the language the visitor writes in, such as "en" or "es". */
  language: z.string(),
  /** A kind message for a redirected subject, in the visitor's language. Empty when allowed. */
  message: z.string(),
});
export type SafetyVerdict = z.infer<typeof SafetyVerdict>;

export type SafetyCheckInput = { subject: string; why: string };

export const InterviewReply = z.object({
  /** One short follow-up question, only when the answer was empty or vague. */
  followUp: z.string().nullable(),
  /** The next Interview question, in the Interview's language. */
  nextQuestion: z.string(),
});
export type InterviewReply = z.infer<typeof InterviewReply>;

export type InterviewFollowUpInput = {
  subject: string;
  language: string;
  /** The question the visitor just answered, as they saw it. */
  question: string;
  answer: string;
  /** False once the Interview has used its one follow-up. */
  mayFollowUp: boolean;
  /** The next question, in English; the reply carries it in the Interview's language. */
  nextQuestion: string;
};

/** The Mission, in the MISSION-FORMAT shape, plus the prior-knowledge Learning record. */
export const MissionDraft = z.object({
  /** A short Course title built around the Mission. */
  title: z.string(),
  why: z.string(),
  successLooksLike: z.array(z.string()),
  /** Includes the sitting length. */
  constraints: z.array(z.string()),
  outOfScope: z.array(z.string()),
  priorKnowledge: z.object({ title: z.string(), body: z.string() }),
});
export type MissionDraft = z.infer<typeof MissionDraft>;

export type WriteMissionInput = {
  subject: string;
  language: string;
  why: string;
  know: string;
  success: string;
  sittingMinutes: number;
};

export interface Teacher {
  /** Haiku: is the subject, with its reason, something to teach? Also detects the visitor's language. */
  checkSafety(input: SafetyCheckInput): Promise<SafetyVerdict>;
  /** Haiku: an optional follow-up for an empty or vague answer, and the next question in the Interview's language. */
  interviewFollowUp(input: InterviewFollowUpInput): Promise<InterviewReply>;
  /** Haiku: turns the Interview answers into the Mission and the prior-knowledge record. */
  writeMission(input: WriteMissionInput): Promise<MissionDraft>;
}
