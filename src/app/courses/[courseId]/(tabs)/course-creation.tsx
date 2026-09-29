"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { CourseCreationView } from "@/course";
import { pausedJobNote } from "@/app/daily-limit";
import { Mascot } from "@/components/mascot";
import { checkCourseCreation, retryCourseCreation, type RetryState } from "./actions";
import styles from "./course.module.css";

const POLL_MS = 2_000;

/**
 * While a new Course is prepared: the Course creation job's progress
 * messages, read from its job row, so a reload or a closed tab loses nothing.
 * Ends by refreshing the Path, which then shows Up next.
 */
export function CourseCreation({
  courseId,
  initial,
  givesCreditBack,
}: {
  courseId: string;
  /** Null for a Course whose preparation never started. */
  initial: CourseCreationView | null;
  /** Deleting the Course would give its Course credit back: it failed before finding anything. */
  givesCreditBack: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [retryState, retry, retrying] = useActionState(
    async (): Promise<RetryState> => {
      const result = await retryCourseCreation(courseId);
      // Polling picks up the job's progress from here.
      if (!result.error) {
        setView((current) => ({
          jobId: current?.jobId ?? "",
          progress: current?.progress ?? [],
          status: "working",
          stalled: false,
          resumesAt: null,
        }));
      }
      return result;
    },
    { error: null },
  );

  const working = view?.status === "working";
  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await checkCourseCreation(courseId).catch(() => undefined);
      if (cancelled || next === undefined) return;
      setView(next);
      if (next?.status === "done") router.refresh();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [working, courseId, router]);

  const progress = view?.progress ?? [];

  return (
    <section
      aria-labelledby="creation-heading"
      className={`sketchy ${styles.creation}`}
    >
      <div className={styles.creationHeader}>
        <Mascot size={44} />
        <h3 id="creation-heading" className={styles.creationTitle}>
          {view?.status === "failed"
            ? "Your teacher hit a snag"
            : view?.status === "paused"
              ? "Your teacher is taking a breather"
              : view?.status === "done"
                ? "Your first Lesson is ready"
                : view
                  ? "Your teacher is preparing this Course"
                  : "This Course isn’t prepared yet"}
        </h3>
      </div>

      {progress.length > 0 && (
        <ol className={styles.creationProgress} role="log" aria-live="polite">
          {progress.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
      )}

      {working && (
        <p className={styles.creationNote} role="status">
          <span className={styles.creationDots} aria-hidden>
            <span />
            <span />
            <span />
          </span>
          This takes a few minutes. You can close this page: it keeps going,
          and your Course will be here when you come back.
        </p>
      )}

      {(view === null || view.status === "failed" || view.status === "paused") && (
        <form action={retry} className={styles.creationRetry}>
          <p className={styles.creationNote} role={view?.status === "failed" ? "alert" : undefined}>
            {view?.resumesAt
              ? pausedJobNote(view.resumesAt)
              : view
                ? "Something went wrong while preparing your Course. Nothing is lost: trying again picks up where it stopped."
                : "Your teacher will find trustworthy sources and choose your first Lesson."}
          </p>
          <button type="submit" className="button-ink" disabled={retrying}>
            {retrying
              ? "Starting…"
              : view?.resumesAt
                ? "Pick up where it stopped"
                : view
                  ? "Try again"
                  : "Prepare my Course"}
          </button>
          {retryState.error && (
            <p className={styles.creationError} role="alert">
              {retryState.error}
            </p>
          )}
          {givesCreditBack && view?.status === "failed" && (
            <p className={styles.creationNote}>
              Or give up on it: deleting this Course, below, gives your Course
              credit back, to start another Course or to ask for a refund.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
