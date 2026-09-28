"use server";

import type { DeleteState } from "@/components/confirm-delete";
import { getViewer, signOut } from "@/server/auth";
import { getCourse } from "@/server/course";

/** "Delete account": removes the signed-in Learner and all their data, then signs out. */
export async function deleteAccount(): Promise<DeleteState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { error: "Sign in again to delete your account." };

  await course.deleteAccount(viewer.learnerId);
  await signOut({ redirectTo: "/" });
  return { error: null };
}
