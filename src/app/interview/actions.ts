"use server";

import { redirect } from "next/navigation";
import type { InterviewView } from "@/course";
import { getViewer } from "@/server/auth";
import { getCourse } from "@/server/course";
import { forgetInterview, readInterviewId, rememberInterview } from "@/server/interview";

export type InterviewState = {
  /** Null until the first answer starts the Interview. */
  view: InterviewView | null;
  error: string | null;
};

const TEACHER_UNAVAILABLE =
  "Your teacher couldn’t reply just now. Please send your answer again.";

/** Sends one answer: starts the Interview on the first, then answers each question in turn. */
export async function sendAnswer(
  previous: InterviewState,
  form: FormData,
): Promise<InterviewState> {
  const [course, viewer, interviewId] = await Promise.all([
    getCourse(),
    getViewer(),
    readInterviewId(),
  ]);
  const answer = String(form.get("answer") ?? "");
  const minutes = form.get("minutes");
  if (previous.view !== null && !interviewId) redirect("/");

  let view: InterviewView | null;
  try {
    if (previous.view === null) {
      view = await course.startInterview({
        subject: String(form.get("subject") ?? ""),
        why: answer,
      });
      await rememberInterview(view.id);
    } else if (minutes !== null) {
      view = await course.chooseSittingLength(interviewId!, Number(minutes), viewer.learnerId);
    } else {
      view = await course.answerInterview(interviewId!, answer, viewer.learnerId);
    }
  } catch (error) {
    console.error(error);
    return { ...previous, error: TEACHER_UNAVAILABLE };
  }
  if (!view) redirect("/");
  return { view, error: null };
}

export type WriteState = { error: string | null };

/** "Write my course": sign in first if needed, then claim the Interview and write the Course. */
export async function writeMyCourse(): Promise<WriteState> {
  const [course, viewer, interviewId] = await Promise.all([
    getCourse(),
    getViewer(),
    readInterviewId(),
  ]);
  if (!interviewId) redirect("/");
  if (viewer.learnerId === null) redirect("/sign-in?next=/interview");

  const claim = await course.claimInterview(interviewId, viewer.learnerId);
  if (claim === "not-found") redirect("/");
  if (claim === "not-yours") {
    return {
      error: "These answers belong to another account. Start a new course from the home page.",
    };
  }

  let courseId: string;
  try {
    const written = await course.writeCourse(interviewId, viewer.learnerId);
    if (!written.ok) {
      return { error: "Answer every question first, then your teacher can write your course." };
    }
    courseId = written.courseId;
  } catch (error) {
    console.error(error);
    return { error: "Your teacher couldn’t write your course just now. Please try again." };
  }

  await forgetInterview();
  redirect(`/courses/${courseId}`);
}
