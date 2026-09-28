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

/** A quiz question as the Teacher writes it; `course` checks the counts and the quiz rule. */
export const QuestionDraft = z.object({
  question: z.string(),
  /** Four, with exactly the same number of words and similar lengths. */
  options: z.array(z.string()),
  /** Index of the right option. */
  answer: z.number().int(),
  /** One sentence on why the right option is right. */
  explanation: z.string(),
});
export type QuestionDraft = z.infer<typeof QuestionDraft>;

/**
 * One Lesson. Counts and references (2–3 sections, citations to this
 * Course's Resources, 3 quiz questions, fitting one sitting) are asked for in
 * the prompt and checked in `course`, which sends a draft that breaks them
 * back once with the reason.
 */
export const LessonDraft = z.object({
  /** Why this matters for their Mission, in one or two sentences. */
  hook: z.string(),
  /** 2 or 3; each body 60–90 words, citing at least one Resource id. */
  sections: z.array(
    z.object({ heading: z.string(), body: z.string(), citations: z.array(z.string()) }),
  ),
  keyIdea: z.string(),
  /** 3 or 4 real-world steps. */
  practice: z.object({ title: z.string(), steps: z.array(z.string()) }),
  practiceMinutes: z.number().int(),
  /** Exactly 3. */
  quiz: z.array(QuestionDraft),
  /** The id of the single best Resource to read next. */
  readNext: z.string(),
  /** At most 3 terms the Lesson introduces. */
  newTerms: z.array(z.object({ term: z.string(), definition: z.string() })),
});
export type LessonDraft = z.infer<typeof LessonDraft>;

export type WriteLessonInput = {
  subject: string;
  /** BCP 47 tag of the Interview's language; the Lesson is written in it. */
  language: string;
  mission: MissionInput;
  /** The Up next Lesson to write. */
  lesson: { index: number; title: string; goal: string };
  /** The Course's kept Resources, cited by id. */
  resources: { id: string; kind: string; title: string; author: string; why: string }[];
  /** Terms the Learner has shown they understand; the Lesson must use these words. */
  glossary: { term: string; definition: string }[];
  /** The Key ideas of earlier Lessons, oldest first; empty for the first Lesson. */
  keyIdeas: { lessonIndex: number; lessonTitle: string; text: string }[];
  /** Oldest first. */
  learningRecords: { number: number; kind: string; title: string; body: string }[];
  /** Why the previous draft was rejected, when this is a second try. */
  feedback: string | null;
};

export type RewriteQuestionInput = {
  subject: string;
  language: string;
  lesson: { title: string; keyIdea: string };
  /** The question that broke the quiz rule. */
  question: QuestionDraft;
  /** What is wrong with it. */
  problem: string;
};

/** One quiz attempt, as evidence a Learning record may cite. */
export type QuizAttemptEvidence = {
  /** Lesson and question number, such as "L2Q3". */
  id: string;
  lessonIndex: number;
  question: string;
  rightOption: string;
  chosenOption: string;
  correct: boolean;
  /** True when the question reviewed an earlier Lesson's Key idea. */
  review: boolean;
};

export type FinishLessonInput = {
  subject: string;
  /** BCP 47 tag of the Interview's language; everything is written in it. */
  language: string;
  mission: MissionInput;
  /** The Lesson being finished. */
  lesson: {
    index: number;
    title: string;
    goal: string;
    keyIdea: string;
    /** The terms it introduced: candidates for the Glossary. */
    newTerms: { term: string; definition: string }[];
  };
  /** Every quiz attempt in the Course, in Lesson and question order; this Lesson's are last. */
  quizAttempts: QuizAttemptEvidence[];
  /** The Lesson's chat, oldest first; ids such as "C1". Empty until the Lesson has a chat. */
  chat: { id: string; from: "teacher" | "learner"; text: string }[];
  /** Records still standing, oldest first. */
  learningRecords: { number: number; kind: string; title: string; body: string }[];
  glossary: { term: string; definition: string }[];
  /** The Reference sheet's topic-specific sections, in sheet order. */
  referenceSections: { title: string; body: string }[];
  /** Oldest first, this Lesson included. */
  finishedLessons: { title: string; goal: string }[];
  resources: { kind: string; title: string; why: string }[];
};

/**
 * What a Finish writes. The evidence rules are asked for in the prompt and
 * checked in `course`, which drops a record or term that breaks them.
 */
export const FinishDraft = z.object({
  /** Only what this Lesson gave evidence of; often empty. */
  learningRecords: z.array(
    z.object({
      kind: z.enum(["understanding", "misconception"]),
      /** At most 8 words. */
      title: z.string(),
      /** One or two sentences naming the evidence, in the third person. */
      body: z.string(),
      /** Ids of the quiz attempts ("L2Q3") and chat messages ("C4") that show it. */
      evidence: z.array(z.string()),
      /** Numbers of standing Learning records this one replaces. */
      supersedes: z.array(z.number().int()),
    }),
  ),
  /** For each of the Lesson's new terms, the number of this Lesson's question that tests it, or null. */
  glossary: z.array(z.object({ term: z.string(), question: z.number().int().nullable() })),
  /** New topic-specific sections, or rewrites of existing ones (same title). */
  referenceSections: z.array(z.object({ title: z.string(), body: z.string() })),
  /** The Lesson to teach next, by the same rules as `pickUpNext`. */
  upNext: UpNextDraft,
});
export type FinishDraft = z.infer<typeof FinishDraft>;

export type AskTeacherInput = {
  subject: string;
  /** BCP 47 tag of the Interview's language; the answer is in it unless the Learner writes in another. */
  language: string;
  mission: MissionInput;
  /** The Lesson the chat belongs to, as the Learner reads it. */
  lesson: {
    index: number;
    title: string;
    goal: string;
    hook: string;
    sections: { heading: string; body: string; citations: string[] }[];
    keyIdea: string;
    practice: { title: string; steps: string[] };
  };
  /** The Course's Resources, the only ground for an answer; cited by id. */
  resources: { id: string; kind: string; title: string; author: string; why: string }[];
  /** Numbered 1, 2, 3…; empty when the Learner opted out of Communities. */
  communities: { number: number; name: string; where: string; why: string; offline: boolean }[];
  /** False when the Learner said "Not for me" to Communities. */
  mayPointToCommunities: boolean;
  /** This Lesson's earlier messages, oldest first. */
  history: { from: "teacher" | "learner"; text: string }[];
  question: string;
};

/**
 * One answer in a Lesson's chat. The length and grounding rules are asked
 * for in the prompt; `course` resolves the citations and the Community, and
 * drops a Community the Learner opted out of.
 */
export const ChatAnswer = z.object({
  /** Under about 80 plain words; cites Resources as "[r3]". */
  answer: z.string(),
  /** The number of the Community to suggest, for a "wisdom" question or an uncertain answer; else null. */
  community: z.number().int().nullable(),
});
export type ChatAnswer = z.infer<typeof ChatAnswer>;

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
  /** Sonnet, structured output: writes the Up next Lesson, grounded in the Course's Resources. */
  writeLesson(input: WriteLessonInput): Promise<LessonDraft>;
  /** Sonnet, structured output: rewrites one quiz question that broke the quiz rule. */
  rewriteQuestion(input: RewriteQuestionInput): Promise<QuestionDraft>;
  /** Sonnet, structured output: weighs a finished Lesson's evidence and picks the next Up next. */
  finishLesson(input: FinishLessonInput): Promise<FinishDraft>;
  /** Haiku, structured output: answers the Learner's question in a Lesson's chat, grounded in the Resources. */
  askTeacher(input: AskTeacherInput): Promise<ChatAnswer>;
}
