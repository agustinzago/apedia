"use server";

import type { ChatMessage, JobView } from "@/course";
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

export type FinishState = { view: JobView | null; error: string | null };

/** Finish: starts the Lesson's Finish job, once every question is answered. */
export async function finishLesson(courseId: string, index: number): Promise<FinishState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { view: null, error: "Sign in again to finish this Lesson." };

  const finished = await course.finishLesson(courseId, index, viewer.learnerId);
  if (!finished.ok) {
    return {
      view: null,
      error:
        finished.reason === "unanswered"
          ? "Answer every question first."
          : finished.reason === "finished"
            ? "This Lesson is already finished. Reload the page to see it."
            : "This Lesson isn’t yours to finish.",
    };
  }
  if (finished.start) await startJobStep(finished.finishing.jobId, await requestOrigin());
  return { view: finished.finishing, error: null };
}

/**
 * The Finish job's progress, for the screen that polls it. A job left
 * waiting (its start was lost) is started again.
 */
export async function checkFinish(courseId: string, index: number): Promise<JobView | null> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  const view = await course.readFinish(courseId, index, viewer.learnerId);
  if (view?.stalled) await startJobStep(view.jobId, await requestOrigin());
  return view;
}

/** "Try again": runs the Finish again after a failure. */
export async function retryFinish(courseId: string, index: number): Promise<RetryState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { error: "Sign in again to finish this Lesson." };

  const retried = await course.retryFinish(courseId, index, viewer.learnerId);
  if (!retried.ok) {
    return {
      error:
        retried.reason === "nothing-to-retry"
          ? "This Lesson is already finished. Reload the page to see it."
          : "This Lesson isn’t yours to finish.",
    };
  }
  await startJobStep(retried.jobId, await requestOrigin());
  return { error: null };
}

export type AskState = { ok: true; messages: ChatMessage[] } | { ok: false; error: string };

/** "Ask your teacher": the question and the Teacher's answer, saved to the Lesson's chat. */
export async function askTeacher(
  courseId: string,
  index: number,
  question: string,
): Promise<AskState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { ok: false, error: "Sign in again to ask your teacher." };

  const asked = await course.askTeacher(courseId, index, question, viewer.learnerId);
  if (!asked.ok) {
    return {
      ok: false,
      error:
        asked.reason === "unavailable"
          ? "Your teacher couldn’t answer just now. Please ask again in a moment."
          : asked.reason === "invalid"
            ? "Write a question first, a little shorter if it’s long."
            : asked.reason === "finished"
              ? "This Lesson is finished, so its chat is closed."
              : "This Lesson’s chat isn’t yours to use.",
    };
  }
  return { ok: true, messages: asked.messages };
}
