"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { JobView } from "@/course";
import { pausedJobNote } from "@/app/daily-limit";
import { Mascot } from "@/components/mascot";
import { BACK } from "@/components/page-transition";
import { checkFinish, finishLesson, retryFinish, type RetryState } from "./actions";
import styles from "./lesson.module.css";

const POLL_MS = 2_000;

/**
 * Finish, on once every question is answered. Pressing it starts the Finish
 * job, whose progress is read from the job row, so a reload or a closed tab
 * loses nothing. Once done, the Learner is taken back to the Path, which
 * shows the Lesson finished and the new Up next.
 */
export function FinishButton({
  courseId,
  index,
  enabled,
  note,
  initial,
}: {
  courseId: string;
  index: number;
  enabled: boolean;
  /** What the bar says before Finish is pressed. */
  note: string;
  /** The Finish job, if Finish was already pressed. */
  initial: JobView | null;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [finishState, finish, starting] = useActionState(
    async (): Promise<{ error: string | null }> => {
      const result = await finishLesson(courseId, index).catch(() => ({
        view: null,
        error: "Finish didn’t go through. Check your connection and try again.",
      }));
      if (result.view) setView(result.view);
      return { error: result.error };
    },
    { error: null },
  );
  const [retryState, retry, retrying] = useActionState(
    async (): Promise<RetryState> => {
      const result = await retryFinish(courseId, index);
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

  const status = view?.status;
  useEffect(() => {
    if (status === "done") router.push(`/courses/${courseId}`, { transitionTypes: BACK });
  }, [status, courseId, router]);

  const working = status === "working";
  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await checkFinish(courseId, index).catch(() => undefined);
      if (cancelled || !next) return;
      setView(next);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [working, courseId, index]);

  if (view === null) {
    return (
      <form action={finish} className={styles.finish} data-noprint>
        <span className={styles.finishNote}>{note}</span>
        <button type="submit" className="button-ink" disabled={!enabled || starting}>
          {starting ? "Finishing…" : "Finish"}
        </button>
        {finishState.error && (
          <p className={styles.error} role="alert">
            {finishState.error}
          </p>
        )}
      </form>
    );
  }

  const failed = status === "failed";
  const pausedUntil = view.resumesAt;
  return (
    <section
      data-noprint
      aria-labelledby="finishing-heading"
      className={`sketchy ${styles.writing}`}
    >
      <div className={styles.writingHeader}>
        <Mascot size={44} />
        <h2 id="finishing-heading" className={styles.writingTitle}>
          {failed
            ? "Your teacher hit a snag"
            : pausedUntil
              ? "Your teacher is taking a breather"
              : status === "done"
                ? "Lesson finished"
                : "Your teacher is weighing this Lesson"}
        </h2>
      </div>

      {view.progress.length > 0 && (
        <ol className={styles.writingProgress} role="log" aria-live="polite">
          {view.progress.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
      )}

      {failed || pausedUntil ? (
        <form action={retry} className={styles.writingRetry}>
          {pausedUntil ? (
            <p className={styles.writingNote} role="status">
              {pausedJobNote(pausedUntil)}
            </p>
          ) : (
            <p className={styles.writingNote} role="alert">
              This Lesson couldn’t be finished just now. Your answers are saved: please try again.
            </p>
          )}
          <button type="submit" className="button-ink" disabled={retrying}>
            {retrying ? "Starting…" : pausedUntil ? "Pick up where it stopped" : "Try again"}
          </button>
          {retryState.error && (
            <p className={styles.error} role="alert">
              {retryState.error}
            </p>
          )}
        </form>
      ) : (
        <p className={styles.writingNote} role="status">
          <span className={styles.writingDots} aria-hidden>
            <span />
            <span />
            <span />
          </span>
          {status === "done"
            ? "Taking you back to your learning path."
            : "Writing down what you learned and choosing your next Lesson."}
        </p>
      )}
    </section>
  );
}
