"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { InterviewMessage, InterviewView } from "@/course";
import { Mascot } from "@/components/mascot";
import { sendAnswer, writeMyCourse, type InterviewState } from "./actions";
import { answerPlaceholder } from "./placeholders";
import { openInterviewPath } from "./subject";
import styles from "./interview.module.css";

const SITTING_CHIPS = [5, 10, 20, 30];


export function InterviewChat({
  subject,
  openingMessages,
  initial,
}: {
  subject: string;
  /** What to show before the Interview is stored. */
  openingMessages: InterviewMessage[];
  initial: InterviewView | null;
}) {
  const [state, send, sending] = useActionState(sendAnswer, {
    view: initial,
    error: null,
  } satisfies InterviewState);
  const [draft, setDraft] = useState("");
  // What the Learner just sent, shown while the Teacher replies.
  const [sent, setSent] = useState("");

  // Clear the box once an answer has gone through; keep it if it failed.
  const [settled, setSettled] = useState(state);
  if (settled !== state) {
    setSettled(state);
    if (!state.error) setDraft("");
  }

  const view = state.view;
  const messages = view ? view.messages : openingMessages;
  const stage = view ? view.stage : "why";
  const questionNumber = view ? view.questionNumber : 1;
  // A refunded Course credit stops the Interview where it is.
  const stopped = view !== null && !view.backed && stage !== "redirected";

  // Once stored, reloading comes back to this Interview instead of starting afresh.
  const storedId = view?.id;
  useEffect(() => {
    if (storedId) window.history.replaceState(null, "", openInterviewPath(storedId));
  }, [storedId]);

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, sending]);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Mascot size={60} />
        <div className={styles.headerText}>
          <span className={styles.teacher}>Your teacher</span>
          <span className={styles.subtitle}>Setting up a course on {subject}</span>
        </div>
        <Link href="/" className={styles.startOver}>
          start over
        </Link>
      </header>

      <ol className={styles.messages} aria-live="polite">
        {messages.map((message, i) => (
          <Bubble key={i} message={message} />
        ))}
        {sending && (
          <>
            <Bubble message={{ from: "learner", text: sent }} />
            <li className={styles.row} data-from="teacher">
              <span className={`${styles.bubble} ${styles.thinking}`} aria-label="Your teacher is replying">
                <span />
                <span />
                <span />
              </span>
            </li>
          </>
        )}
      </ol>
      <div ref={end} />

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      {stopped && (
        <p className={styles.error} role="alert">
          This Interview no longer has a Course credit behind it (it was
          refunded), so it can’t go on.
        </p>
      )}

      {!sending && !stopped && (stage === "why" || stage === "know" || stage === "success") && (
        <form
          action={send}
          onSubmit={() => setSent(draft)}
          className={styles.answerForm}
        >
          <input type="hidden" name="subject" value={subject} />
          <div className={styles.answerBox}>
            <label htmlFor="answer" className="visually-hidden">
              Your answer
            </label>
            <textarea
              id="answer"
              name="answer"
              rows={2}
              maxLength={1000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={answerPlaceholder(subject, questionNumber ?? 1)}
              autoFocus
              className={styles.answer}
            />
            <button type="submit" className={styles.send}>
              send
            </button>
          </div>
          <span className={styles.step}>question {questionNumber} of 4</span>
        </form>
      )}

      {!sending && !stopped && stage === "sitting" && (
        <form action={send} className={styles.sitting}>
          <span className="visually-hidden">Minutes per sitting</span>
          {SITTING_CHIPS.map((minutes) => (
            <button
              key={minutes}
              type="submit"
              name="minutes"
              value={minutes}
              onClick={() => setSent(`${minutes} minutes`)}
              className={styles.sittingChip}
            >
              {minutes} min
            </button>
          ))}
          <span className={styles.step}>question 4 of 4</span>
        </form>
      )}

      {!stopped && stage === "complete" && view && <WriteCourse interviewId={view.id} />}

      {(stage === "redirected" || stopped) && (
        <Link href="/" className={styles.homeLink}>
          Back to the home page
        </Link>
      )}
    </main>
  );
}

function Bubble({ message }: { message: InterviewMessage }) {
  return (
    <li className={styles.row} data-from={message.from}>
      <span className={styles.bubble}>
        <span className="visually-hidden">
          {message.from === "teacher" ? "Your teacher: " : "You: "}
        </span>
        {message.text || "…"}
      </span>
    </li>
  );
}

function WriteCourse({ interviewId }: { interviewId: string }) {
  const [state, write, writing] = useActionState(writeMyCourse, { error: null });

  return (
    <form action={write} className={`sticky-note ${styles.write}`}>
      <input type="hidden" name="interviewId" value={interviewId} />
      <p className={styles.writeTitle}>Thank you. That’s everything I need.</p>
      <p className={styles.writeNote}>
        Your teacher will write your Mission, then start preparing your course.
        This uses your Course credit.
      </p>
      <button type="submit" className="button-ink" disabled={writing}>
        {writing ? "Writing your Mission…" : "Write my course"}
      </button>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
