import { z } from "zod";

/** A Resource id within one Course, such as "r1". Never shown to the Learner. */
export const ResourceId = z.string().regex(/^r\d+$/);

export const Term = z.object({
  term: z.string(),
  definition: z.string(),
});

export const Question = z.object({
  question: z.string(),
  options: z.array(z.string()).length(4),
  answer: z.number().int().min(0).max(3),
  explanation: z.string(),
  // True when the question reviews an earlier Lesson's Key idea.
  review: z.boolean(),
});

export const LessonContent = z.object({
  hook: z.string(),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
        citations: z.array(ResourceId).min(1),
      }),
    )
    .min(2)
    .max(3),
  keyIdea: z.string(),
  practice: z.object({
    title: z.string(),
    steps: z.array(z.string()).min(3).max(4),
  }),
  practiceMinutes: z.number().int(),
  quiz: z.array(Question).length(3),
  readNext: ResourceId,
  newTerms: z.array(Term).max(3),
});

export type LessonContent = z.infer<typeof LessonContent>;
