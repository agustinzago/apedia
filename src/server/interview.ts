import { cookies } from "next/headers";
import { cache } from "react";
import { getViewer } from "./auth";
import { getCourse } from "./course";

/**
 * The anonymous Interview lives in the database; this browser holds its id
 * in a cookie, so the answers survive the sign-in round trip.
 */
const INTERVIEW_COOKIE = "apedia-interview";
const WEEK = 60 * 60 * 24 * 7;

export async function readInterviewId(): Promise<string | null> {
  return (await cookies()).get(INTERVIEW_COOKIE)?.value ?? null;
}

/** Only from a Server Action. */
export async function rememberInterview(interviewId: string): Promise<void> {
  (await cookies()).set(INTERVIEW_COOKIE, interviewId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: WEEK,
    path: "/",
  });
}

/** Only from a Server Action. */
export async function forgetInterview(): Promise<void> {
  (await cookies()).delete(INTERVIEW_COOKIE);
}

/** This browser's Interview, if it has one it may read. */
export const loadInterview = cache(async () => {
  const interviewId = await readInterviewId();
  if (!interviewId) return null;
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  return course.readInterview(interviewId, viewer.learnerId);
});
