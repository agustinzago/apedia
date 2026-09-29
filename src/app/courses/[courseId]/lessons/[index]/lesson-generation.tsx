"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { JobView } from "@/course";
import { pausedJobNote } from "@/app/daily-limit";
import { BuyCourse } from "@/app/purchase/buy-course";
import { Mascot } from "@/components/mascot";
import {
  checkLessonGeneration,
  openLesson,
  retryLessonGeneration,
  type RetryState,
} from "./actions";
import styles from "./lesson.module.css";

const POLL_MS = 2_000;

/**
 * While the Up next Lesson is written: the first open starts the Lesson
 * generation job, and its progress messages are read from the job row, so a
 * reload or a closed tab loses nothing. Ends by refreshing the page, which
 * then shows the Lesson.
 */
export function LessonGeneration({
  courseId,
  index,
  initial,
}: {
  courseId: string;
  index: number;
  /** Null until the Lesson is first opened. */
  initial: JobView | null;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [openError, setOpenError] = useState<string | null>(null);
  /**
   * Set when the Course's Lessons or today's are used up, or the Teacher is
   * paused: says what next.
   */
  const [limit, setLimit] = useState<{
    reason: "lessons-used-up" | "daily-limit" | "paused";
    note: string;
  } | null>(null);
  const [retryState, retry, retrying] = useActionState(
    async (): Promise<RetryState> => {
      const result = await retryLessonGeneration(courseId, index);
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

  // Opening starts the writing the first time; it is safe to repeat.
  const needsOpen = initial === null || initial.status === "working";
  useEffect(() => {
    if (!needsOpen) return;
    let cancelled = false;
    openLesson(courseId, index)
      .then((opened) => {
        if (cancelled) return;
        if (opened.limited) setLimit({ reason: opened.limited, note: opened.error ?? "" });
        else if (opened.error) setOpenError(opened.error);
        else if (opened.view === null) router.refresh();
        else setView(opened.view);
      })
      .catch(() => {
        if (!cancelled) setOpenError("This Lesson couldn’t be opened just now. Reload to try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [needsOpen, courseId, index, router]);

  const working = view !== null && view.status === "working";
  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await checkLessonGeneration(courseId, index).catch(() => undefined);
      if (cancelled || next === undefined) return;
      setView(next);
      if (next?.status === "done") router.refresh();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [working, courseId, index, router]);

  const failed = view?.status === "failed";
  const pausedUntil = view?.resumesAt ?? null;
  const progress = view?.progress ?? [];

  return (
    <section aria-labelledby="writing-heading" className={`sketchy ${styles.writing}`}>
      <div className={styles.writingHeader}>
        <Mascot size={44} />
        <h2 id="writing-heading" className={styles.writingTitle}>
          {limit?.reason === "lessons-used-up"
            ? "This Course’s Lessons are all written"
            : limit?.reason === "daily-limit"
              ? "That’s all the new Lessons for today"
              : limit || pausedUntil
                ? "Your teacher is taking a breather"
                : failed
                  ? "Your teacher hit a snag"
                  : view?.status === "done"
                    ? "Your Lesson is ready"
                    : "Your teacher is writing this Lesson"}
        </h2>
      </div>

      {progress.length > 0 && (
        <ol className={styles.writingProgress} role="log" aria-live="polite">
          {progress.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
      )}

      {limit ? (
        <>
          <p className={styles.writingNote} role="status">
            {limit.note}
          </p>
          {limit.reason === "lessons-used-up" && <BuyCourse from="/" />}
        </>
      ) : openError ? (
        <p className={styles.error} role="alert">
          {openError}
        </p>
      ) : failed || pausedUntil ? (
        <form action={retry} className={styles.writingRetry}>
          {pausedUntil ? (
            <p className={styles.writingNote} role="status">
              {pausedJobNote(pausedUntil)}
            </p>
          ) : (
            <p className={styles.writingNote} role="alert">
              This Lesson couldn’t be written just now. Nothing is lost: please try again.
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
        view?.status !== "done" && (
          <p className={styles.writingNote} role="status">
            <span className={styles.writingDots} aria-hidden>
              <span />
              <span />
              <span />
            </span>
            This takes about a minute. Once written, your Lesson stays as it is.
          </p>
        )
      )}
    </section>
  );
}
