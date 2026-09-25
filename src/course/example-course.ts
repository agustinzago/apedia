import { z } from "zod";
import { schema, type Db } from "@/db";
import fixtureJson from "./example-course.json";
import { LessonContent, ResourceId, Term } from "./lesson-content";

export const EXAMPLE_COURSE_ID = "example-music-theory";

const isoDate = z.iso.datetime().transform((s) => new Date(s));

/**
 * The shape of the committed Example course fixture. It holds the whole
 * Course — including parts later tickets will seed — so it can double as
 * test data.
 */
export const ExampleCourseFixture = z.object({
  id: z.literal(EXAMPLE_COURSE_ID),
  subject: z.string(),
  title: z.string(),
  language: z.string(),
  createdAt: isoDate,
  mission: z.object({
    why: z.string(),
    success: z.array(z.string()).min(1),
    constraints: z.array(z.string()),
    sittingMinutes: z.number().int().positive(),
    outOfScope: z.array(z.string()),
  }),
  resources: z.array(
    z.object({
      id: ResourceId,
      kind: z.enum(["book", "docs", "course", "article", "site"]),
      title: z.string(),
      author: z.string(),
      url: z.url(),
      why: z.string(),
      language: z.string(),
    }),
  ),
  communities: z.array(
    z.object({
      name: z.string(),
      where: z.string(),
      url: z.url().nullable(),
      why: z.string(),
      offline: z.boolean(),
    }),
  ),
  gaps: z.array(z.object({ description: z.string() })),
  lessons: z.array(
    z.object({
      index: z.number().int().positive(),
      title: z.string(),
      goal: z.string(),
      openedAt: isoDate.nullable(),
      finishedAt: isoDate.nullable(),
      content: LessonContent.nullable(),
      quizAttempts: z.array(
        z.object({
          questionIndex: z.number().int().min(0),
          chosenOption: z.number().int().min(0).max(3),
          at: isoDate,
        }),
      ),
    }),
  ),
  learningRecords: z.array(
    z.object({
      number: z.number().int().positive(),
      kind: z.enum(schema.learningRecordKind.enumValues),
      title: z.string(),
      body: z.string(),
      lessonIndex: z.number().int().positive().nullable(),
      createdAt: isoDate,
    }),
  ),
  glossary: z.array(Term.extend({ lessonIndex: z.number().int().positive() })),
  referenceSections: z.array(z.object({ title: z.string(), body: z.string() })),
});

export type ExampleCourseFixture = z.infer<typeof ExampleCourseFixture>;

export const exampleCourse: ExampleCourseFixture =
  ExampleCourseFixture.parse(fixtureJson);

/** Writes the Example course into the database unless it is already there. */
export async function seedExampleCourse(db: Db): Promise<void> {
  const fx = exampleCourse;
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.course)
      .values({
        id: fx.id,
        learnerId: null,
        isExample: true,
        subject: fx.subject,
        title: fx.title,
        language: fx.language,
        missionWhy: fx.mission.why,
        missionSuccess: fx.mission.success,
        missionConstraints: fx.mission.constraints,
        missionOutOfScope: fx.mission.outOfScope,
        sittingMinutes: fx.mission.sittingMinutes,
        createdAt: fx.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.course.id });
    if (inserted.length === 0) return;

    const lessonIds = new Map<number, string>();
    for (const l of fx.lessons) {
      const [row] = await tx
        .insert(schema.lesson)
        .values({
          courseId: fx.id,
          index: l.index,
          title: l.title,
          goal: l.goal,
          content: l.content,
          openedAt: l.openedAt,
          finishedAt: l.finishedAt,
          createdAt: fx.createdAt,
        })
        .returning({ id: schema.lesson.id });
      lessonIds.set(l.index, row.id);

      if (l.quizAttempts.length > 0) {
        await tx.insert(schema.quizAttempt).values(
          l.quizAttempts.map((a) => ({
            lessonId: row.id,
            questionIndex: a.questionIndex,
            chosenOption: a.chosenOption,
            correct: l.content?.quiz[a.questionIndex]?.answer === a.chosenOption,
            createdAt: a.at,
          })),
        );
      }
    }

    if (fx.learningRecords.length > 0) {
      await tx.insert(schema.learningRecord).values(
        fx.learningRecords.map((r) => ({
          courseId: fx.id,
          number: r.number,
          kind: r.kind,
          title: r.title,
          body: r.body,
          lessonId: r.lessonIndex === null ? null : lessonIds.get(r.lessonIndex),
          createdAt: r.createdAt,
        })),
      );
    }
  });
}
