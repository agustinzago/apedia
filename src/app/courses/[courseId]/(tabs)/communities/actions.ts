"use server";

import { refresh } from "next/cache";
import { getViewer } from "@/server/auth";
import { getCourse } from "@/server/course";

export type OptOutState = { error: string | null };

/** "Not for me", or turning Communities back on, for the signed-in Learner's own Course. */
export async function setCommunityOptOut(
  courseId: string,
  optedOut: boolean,
): Promise<OptOutState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { error: "Sign in again to change this." };

  const result = await course.setCommunityOptOut(courseId, viewer.learnerId, optedOut);
  if (!result.ok) {
    return {
      error:
        result.reason === "read-only"
          ? "The Example course is read-only."
          : "This Course isn’t yours to change.",
    };
  }
  refresh();
  return { error: null };
}
