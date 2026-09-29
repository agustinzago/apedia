"use server";

import { redirect } from "next/navigation";
import type { Busy, DailyLimitReached, InterviewView, NoCourseCredit, SpendPaused } from "@/course";
import type { DeleteState } from "@/components/confirm-delete";
import { breatherNote, untilReset } from "@/app/daily-limit";
import { getViewer } from "@/server/auth";
import { getCourse } from "@/server/course";
import { requestOrigin, startJobStep } from "@/server/jobs";
import { interviewPath, openInterviewPath, typedSubject } from "./subject";

export type InterviewState = {
  /** Null until the first answer starts the Interview. */
  view: InterviewView | null;
  error: string | null;
};

const TEACHER_UNAVAILABLE =
  "Your teacher couldn’t reply just now. Please send your answer again.";

/** No available Course credit backs the Interview any more, or none is free to start one. */
const NO_CREDIT = {
  start:
    "Your Course credits are all in use. Reload the page to buy a Course or continue an Interview you started.",
  goOn: "This Interview no longer has a Course credit behind it (it was refunded), so it can’t go on. Start a new course from the home page.",
};

/**
 * Sends one answer: starts the Interview on the first, then answers each
 * question in turn. Only a signed-in Learner holding a Course credit gets
 * this far; `course` refuses anyone else.
 */
export async function sendAnswer(
  previous: InterviewState,
  form: FormData,
): Promise<InterviewState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  const subject = typedSubject(form.get("subject"));
  const learnerId = viewer.learnerId;
  if (learnerId === null) {
    redirect(`/sign-in?${new URLSearchParams({ next: subject ? interviewPath(subject) : "/" })}`);
  }
  const answer = String(form.get("answer") ?? "");
  const minutes = form.get("minutes");

  let view: InterviewView | NoCourseCredit | DailyLimitReached | SpendPaused | Busy | null;
  try {
    if (previous.view === null) {
      view = await course.startInterview({ subject, why: answer }, learnerId);
    } else if (minutes !== null) {
      view = await course.chooseSittingLength(previous.view.id, Number(minutes), learnerId);
    } else {
      view = await course.answerInterview(previous.view.id, answer, learnerId);
    }
  } catch (error) {
    console.error(error);
    return { ...previous, error: TEACHER_UNAVAILABLE };
  }
  if (!view) redirect("/");
  if ("reason" in view) {
    if (view.reason === "no-credit") {
      return { ...previous, error: previous.view === null ? NO_CREDIT.start : NO_CREDIT.goOn };
    }
    if (view.reason === "daily-limit") {
      return { ...previous, error: interviewLimitNote(view) };
    }
    if (view.reason === "busy") {
      return {
        ...previous,
        error: "Your teacher is still on your last answer. Reload the page in a moment to see where you are.",
      };
    }
    return {
      ...previous,
      error: `${breatherNote(view.resumesAt)}${previous.view ? " Your answers so far are saved." : ""}`,
    };
  }
  return { view, error: null };
}

/** Only starting counts toward the limit: Interviews under way go on. */
function interviewLimitNote({ limit, resetsAt }: DailyLimitReached): string {
  return `You’ve started ${limit === 1 ? "an Interview" : `${limit} Interviews`} today, which is the daily limit. Your Course credit is kept for you: come back ${untilReset(resetsAt)} to start this one.`;
}

export type WriteState = { error: string | null };

/**
 * "Write my course": writes the Course from the finished Interview, using
 * its Course credit, and starts preparing it. The Path tab shows the progress.
 */
export async function writeMyCourse(_previous: WriteState, form: FormData): Promise<WriteState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  const interviewId = String(form.get("interviewId") ?? "");
  if (viewer.learnerId === null) {
    redirect(`/sign-in?${new URLSearchParams({ next: openInterviewPath(interviewId) })}`);
  }

  let courseId: string;
  try {
    const written = await course.writeCourse(interviewId, viewer.learnerId);
    if (!written.ok) {
      if (written.reason === "not-found" || written.reason === "not-yours") {
        return { error: "These answers aren’t yours. Start a new course from the home page." };
      }
      return {
        error:
          written.reason === "paused"
            ? `Apedia is taking a breather today. Your answers are saved: come back ${untilReset(written.resumesAt)} and press “Write my course” again.`
            : written.reason === "no-credit"
              ? NO_CREDIT.goOn
              : written.reason === "busy"
                ? "Your teacher is already writing your course. Reload the page in a moment to open it."
                : "Answer every question first, then your teacher can write your course.",
      };
    }
    courseId = written.courseId;
    if (written.jobId) await startJobStep(written.jobId, await requestOrigin());
  } catch (error) {
    console.error(error);
    return { error: "Your teacher couldn’t write your course just now. Please try again." };
  }

  redirect(`/courses/${courseId}`);
}

/**
 * Lets go of the Learner's open Interview, for good, so its Course credit
 * can back an Interview on the new subject instead.
 */
export async function startOverOn(interviewId: string, subject: string): Promise<DeleteState> {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return { error: "Sign in again to start over." };

  const discarded = await course.discardInterview(interviewId, viewer.learnerId);
  if (!discarded.ok) return { error: "That Interview isn’t yours, or it already became a Course." };
  const typed = typedSubject(subject);
  redirect(typed ? interviewPath(typed) : "/");
}
