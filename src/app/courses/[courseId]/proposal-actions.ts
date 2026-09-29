"use server";

import { refresh } from "next/cache";
import type { DecideProposalResult } from "@/course";
import { breatherNote } from "@/app/daily-limit";
import { getViewer } from "@/server/auth";
import { getCourse } from "@/server/course";
import { requestOrigin, startJobStep } from "@/server/jobs";

export type DecideState = { decided: "confirmed" | "declined" | null; error: string | null };

function errorFor(result: Extract<DecideProposalResult, { ok: false }>): string {
  switch (result.reason) {
    case "decided":
      return "This has already been decided. Reload the page to see where things stand.";
    case "busy":
      return "Your teacher is already on it. Reload the page in a moment to see where things stand.";
    case "unavailable":
      return "Your teacher couldn’t choose your next Lesson just now, so nothing changed. Please try again in a moment.";
    case "paused":
      return `${breatherNote(result.resumesAt)} Nothing changed: confirm this again then.`;
    default:
      return "This Course isn’t yours to change.";
  }
}

/** With the proposal decided, Up next can be written in the background. */
async function writeUpNextAhead(courseId: string, learnerId: string) {
  const jobId = await (await getCourse()).writeUpNextAhead(courseId, learnerId);
  if (jobId) await startJobStep(jobId, await requestOrigin());
}

/** "Confirm": the Mission change or Done takes effect. */
export async function confirmProposal(courseId: string, proposalId: string): Promise<DecideState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { decided: null, error: "Sign in again to decide this." };

  const result = await course.confirmProposal(courseId, proposalId, viewer.learnerId);
  if (!result.ok) return { decided: null, error: errorFor(result) };
  await writeUpNextAhead(courseId, viewer.learnerId);
  refresh();
  return { decided: "confirmed", error: null };
}

/** "Not now": the proposal is set aside and nothing changes. */
export async function declineProposal(courseId: string, proposalId: string): Promise<DecideState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { decided: null, error: "Sign in again to decide this." };

  const result = await course.declineProposal(courseId, proposalId, viewer.learnerId);
  if (!result.ok) return { decided: null, error: errorFor(result) };
  await writeUpNextAhead(courseId, viewer.learnerId);
  refresh();
  return { decided: "declined", error: null };
}
