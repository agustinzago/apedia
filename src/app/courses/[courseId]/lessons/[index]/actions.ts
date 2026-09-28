"use server";

import type { JobView } from "@/course";
import { getViewer } from "@/server/auth";
import { getCourse } from "@/server/course";
import { requestOrigin, startJobStep } from "@/server/jobs";

export type OpenState = { view: JobView | null; error: string | null };

/**
 * The Learner opened an unwritten Lesson: starts writing it the first time,
 * and reports on the writing after that.
 */
export async function openLesson(courseId: string, index: number): Promise<OpenState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { view: null, error: "Sign in again to open this Lesson." };

  const opened = await course.openLesson(courseId, index, viewer.learnerId);
  if (!opened.ok) return { view: null, error: "This Lesson isn’t yours to open." };
  if (opened.start && opened.generation) {
    await startJobStep(opened.generation.jobId, await requestOrigin());
  }
  return { view: opened.generation, error: null };
}

/**
 * The Lesson generation job's progress, for the screen that polls it. A job
 * left waiting (its start was lost) is started again.
 */
export async function checkLessonGeneration(
  courseId: string,
  index: number,
): Promise<JobView | null> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  const view = await course.readLessonGeneration(courseId, index, viewer.learnerId);
  if (view?.stalled) await startJobStep(view.jobId, await requestOrigin());
  return view;
}

export type RetryState = { error: string | null };

/** "Try again": writes the Lesson again after a failure. */
export async function retryLessonGeneration(courseId: string, index: number): Promise<RetryState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { error: "Sign in again to keep writing this Lesson." };

  const retried = await course.retryLessonGeneration(courseId, index, viewer.learnerId);
  if (!retried.ok) {
    return {
      error:
        retried.reason === "nothing-to-retry"
          ? "This Lesson is already written. Reload the page to see it."
          : "This Lesson isn’t yours to write.",
    };
  }
  await startJobStep(retried.jobId, await requestOrigin());
  return { error: null };
}

export type AnswerState =
  | { ok: true; chosenOption: number; allAnswered: boolean }
  | { ok: false; error: string };

/** Stores the Learner's pick as a quiz attempt, which locks the question. */
export async function answerQuestion(
  courseId: string,
  index: number,
  questionIndex: number,
  chosenOption: number,
): Promise<AnswerState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { ok: false, error: "Sign in again to save your answer." };

  const answered = await course.answerQuestion(
    courseId,
    index,
    questionIndex,
    chosenOption,
    viewer.learnerId,
  );
  if (!answered.ok) {
    return {
      ok: false,
      error:
        answered.reason === "finished"
          ? "This Lesson is finished, so its answers can’t change."
          : "Your answer couldn’t be saved. Reload the page and try again.",
    };
  }
  return {
    ok: true,
    chosenOption: answered.attempt.chosenOption,
    allAnswered: answered.allAnswered,
  };
}
