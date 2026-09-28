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

/** The Mission as the Teacher is given it when researching and choosing Lessons. */
export type MissionInput = {
  why: string;
  successLooksLike: string[];
  /** Includes the sitting length. */
  constraints: string[];
  outOfScope: string[];
  sittingMinutes: number;
};

/** What the research search found, kept on the job row so later steps can be retried without searching again. */
export const SearchFindings = z.object({
  /** The Teacher's notes on the candidates it found. */
  text: z.string(),
  /** Every page the web search returned. */
  results: z.array(z.object({ url: z.string(), title: z.string() })),
});
export type SearchFindings = z.infer<typeof SearchFindings>;

export type ResearchSearchInput = {
  subject: string;
  /** BCP 47 tag of the Interview's language; Resources in it are preferred. */
  language: string;
  mission: MissionInput;
};

export type ResearchStructureInput = ResearchSearchInput & {
  findings: SearchFindings;
};

export const ResourceKind = z.enum(["book", "docs", "course", "article", "site"]);

/**
 * Resources, Communities and Gaps drawn from the search findings. Counts
 * (5–10 Resources, 2–3 Communities) are asked for in the prompt and enforced
 * in `course`, which also runs the URL rules.
 */
export const ResearchDraft = z.object({
  resources: z.array(
    z.object({
      kind: ResourceKind,
      title: z.string(),
      author: z.string(),
      /** Exactly as it appeared in the search results. */
      url: z.string(),
      /** One line: why this Resource, for this Mission. */
      why: z.string(),
      /** BCP 47 tag of the Resource's language. */
      language: z.string(),
    }),
  ),
  communities: z.array(
    z.object({
      name: z.string(),
      where: z.string(),
      url: z.string().nullable(),
      why: z.string(),
      offline: z.boolean(),
    }),
  ),
  /** Parts of the Mission no Resource covers. */
  gaps: z.array(z.object({ description: z.string() })),
});
export type ResearchDraft = z.infer<typeof ResearchDraft>;

export type PickUpNextInput = {
  subject: string;
  language: string;
  mission: MissionInput;
  /** Oldest first. */
  learningRecords: { number: number; kind: string; title: string; body: string }[];
  /** Oldest first; empty for the first Lesson. */
  finishedLessons: { title: string; goal: string }[];
  resources: { kind: string; title: string; why: string }[];
  /** Why the previous answer was rejected, when this is a second try. */
  feedback: string | null;
};

/** The single Lesson to teach next. */
export const UpNextDraft = z.object({
  /** At most 6 words. */
  title: z.string(),
  /** Starts with an observable verb; never "understand" or "learn". */
  goal: z.string(),
  /** Reading plus practice, within the sitting length. */
  minutes: z.number().int(),
});
export type UpNextDraft = z.infer<typeof UpNextDraft>;

export interface Teacher {
  /** Haiku: is the subject, with its reason, something to teach? Also detects the visitor's language. */
  checkSafety(input: SafetyCheckInput): Promise<SafetyVerdict>;
  /** Haiku: an optional follow-up for an empty or vague answer, and the next question in the Interview's language. */
  interviewFollowUp(input: InterviewFollowUpInput): Promise<InterviewReply>;
  /** Haiku: turns the Interview answers into the Mission and the prior-knowledge record. */
  writeMission(input: WriteMissionInput): Promise<MissionDraft>;
  /** Sonnet with web search (at most 8 searches, 240 s): finds candidate Resources and Communities. */
  researchSearch(input: ResearchSearchInput): Promise<SearchFindings>;
  /** Sonnet, structured output: turns the search findings into Resources, Communities and Gaps. */
  researchStructure(input: ResearchStructureInput): Promise<ResearchDraft>;
  /** Sonnet: picks Up next from the Mission's highest-leverage success item and the Learning records. */
  pickUpNext(input: PickUpNextInput): Promise<UpNextDraft>;
}
