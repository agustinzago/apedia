import { describe, expect, it } from "vitest";
import { exampleCourses } from "./example-course";
import { lessonProblem, quizRuleProblem } from "./lessons";

/**
 * The Example courses are what a visitor judges Apedia by, so each keeps the
 * rules every Lesson the Teacher writes must keep.
 */
describe.each(exampleCourses.map((fx) => [fx.subject, fx] as const))(
  "the %s Example course",
  (_, fx) => {
    const refs = new Set(fx.resources.map((r) => r.id));

    it("has a unique id and Resource ids", () => {
      expect(exampleCourses.filter((other) => other.id === fx.id)).toHaveLength(1);
      expect(refs.size).toBe(fx.resources.length);
    });

    it("numbers its Lessons 1, 2, 3… and writes all but at most the last", () => {
      expect(fx.lessons.map((l) => l.index)).toEqual(fx.lessons.map((_, i) => i + 1));
      expect(fx.lessons.slice(0, -1).every((l) => l.content && l.finishedAt)).toBe(true);
    });

    it.each(fx.lessons.filter((l) => l.content).map((l) => [l.index, l] as const))(
      "keeps the Lesson rules in Lesson %i",
      (_, lesson) => {
        const content = lesson.content!;
        expect(lessonProblem(content, { refs, sittingMinutes: fx.mission.sittingMinutes })).toBeNull();
        for (const question of content.quiz) expect(quizRuleProblem(question)).toBeNull();
        // From the second Lesson on, only the last question is the review.
        expect(content.quiz.map((q) => q.review)).toEqual([false, false, lesson.index > 1]);
        for (const attempt of lesson.quizAttempts) {
          expect(content.quiz[attempt.questionIndex]).toBeDefined();
        }
      },
    );

    it("files its Learning records and Glossary under its own Lessons", () => {
      const indexes = new Set(fx.lessons.map((l) => l.index));
      for (const r of fx.learningRecords) {
        if (r.lessonIndex !== null) expect(indexes).toContain(r.lessonIndex);
      }
      for (const g of fx.glossary) expect(indexes).toContain(g.lessonIndex);
      expect(fx.learningRecords.map((r) => r.number)).toEqual(
        fx.learningRecords.map((_, i) => i + 1),
      );
    });
  },
);
