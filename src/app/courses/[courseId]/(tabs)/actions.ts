"use server";

import type { CourseCreationView } from "@/course";
import { getViewer } from "@/server/auth";
import { getCourse } from "@/server/course";
import { requestOrigin, startJobStep } from "@/server/jobs";

/**
 * The Course creation job's progress, for the screen that polls it. A job
 * left waiting (its start was lost) is started again.
 */
export async function checkCourseCreation(courseId: string): Promise<CourseCreationView | null> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  const view = await course.readCourseCreation(courseId, viewer.learnerId);
  if (view?.stalled) await startJobStep(view.jobId, await requestOrigin());
  return view;
}

export type RetryState = { error: string | null };

/** "Try again": resumes the Course creation job from the step that failed. */
export async function retryCourseCreation(courseId: string): Promise<RetryState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { error: "Sign in again to keep preparing this Course." };

  const retried = await course.retryCourseCreation(courseId, viewer.learnerId);
  if (!retried.ok) {
    return {
      error:
        retried.reason === "nothing-to-retry"
          ? "This Course is already prepared. Reload the page to see it."
          : "This Course isn’t yours to prepare.",
    };
  }
  await startJobStep(retried.jobId, await requestOrigin());
  return { error: null };
}
