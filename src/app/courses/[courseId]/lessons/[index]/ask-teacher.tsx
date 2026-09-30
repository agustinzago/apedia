"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, CommunityEntry, ProposalView } from "@/course";
import { COURSE_CREDIT } from "@/course/course-credit";
import {
  questionsLeftNote,
  questionsUsedUpNote,
  SHOW_QUESTIONS_LEFT_BELOW,
} from "@/app/allowance";
import { BuyCourse } from "@/app/purchase/buy-course";
import { Mascot } from "@/components/mascot";
import { ProposalCard } from "../../proposal-card";
import { askTeacher, type AskState } from "./actions";
import styles from "./lesson.module.css";

/**
 * Ask your teacher: the Lesson's chat. A question is saved with its answer
 * once the Teacher has replied, so the chat is there on the next visit.
 * Citations show as numbered links to the Course's Resources. A Mission
 * change the Teacher proposes shows under the chat, to confirm or not.
 * Once fewer than 20 of the Course's questions are left, it says how many;
 * with none left, it takes no more.
 */
export function AskTeacher({
  courseId,
  lessonIndex,
  initial,
  proposals: initialProposals,
  maxLength,
  closedNote,
  questionsLeft: initialLeft,
}: {
  courseId: string;
  lessonIndex: number;
  initial: ChatMessage[];
  /** Mission changes proposed in this chat, waiting for the Learner. */
  proposals: ProposalView[];
  maxLength: number;
  /** Why the chat takes no questions (read-only or finished); null while it is open. */
  closedNote: string | null;
  /** The questions left across the Course's Lessons; null when there is no allowance. */
  questionsLeft: number | null;
}) {
  const inputId = useId();
  const [messages, setMessages] = useState(initial);
  const [left, setLeft] = useState(initialLeft);
  const usedUp = left === 0;
  const [proposals, setProposals] = useState(initialProposals);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLOListElement>(null);

  // Scrolls the chat panel itself: scrollIntoView on an element inside it
  // may scroll only the page, leaving a new reply out of sight.
  useEffect(() => {
    if (asking !== null || messages.length > initial.length) {
      log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
    }
  }, [asking, messages.length, initial.length]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (question === "" || asking !== null || usedUp) return;
    setAsking(question);
    setDraft("");
    setError(null);
    const asked = await askTeacher(courseId, lessonIndex, question).catch(
      (): AskState => ({
        ok: false,
        error: "Your question didn’t go through. Check your connection and ask again.",
      }),
    );
    setAsking(null);
    if (!asked.ok) {
      // Nothing was saved: give the question back to try again.
      setDraft(question);
      if (asked.usedUp) setLeft(0);
      else setError(asked.error);
      return;
    }
    setMessages((current) => [...current, ...asked.messages]);
    setLeft(asked.questionsLeft);
    const { proposal } = asked;
    // A newer proposal takes the place of an earlier one of its kind.
    if (proposal) {
      setProposals((current) => [...current.filter((p) => p.kind !== proposal.kind), proposal]);
    }
  }

  if (closedNote !== null && messages.length === 0) {
    return (
      <section data-noprint aria-labelledby="ask-heading" className={styles.ask}>
        <AskHeading />
        <p className={styles.askNote}>{closedNote}</p>
      </section>
    );
  }

  return (
    <section data-noprint aria-labelledby="ask-heading" className={styles.ask}>
      <AskHeading />
      {(messages.length > 0 || asking !== null) && (
        <ol ref={log} className={styles.chat} role="log" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={styles.chatRow} data-from={m.from}>
              <Message message={m} />
            </li>
          ))}
          {asking !== null && (
            <>
              <li className={styles.chatRow} data-from="learner">
                <span className={styles.chatBubble}>{asking}</span>
              </li>
              <li className={styles.chatRow} data-from="teacher">
                <span className={styles.askNote} role="status">
                  thinking…
                </span>
              </li>
            </>
          )}
        </ol>
      )}
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} courseId={courseId} proposal={proposal} />
      ))}
      {closedNote !== null ? (
        <p className={styles.askNote}>{closedNote}</p>
      ) : (
        <>
          <form onSubmit={ask} className={styles.askForm}>
            <label htmlFor={inputId} className="visually-hidden">
              Your question
            </label>
            <input
              id={inputId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={maxLength}
              placeholder={usedUp ? "No questions left in this Course" : "Anything unclear?"}
              autoComplete="off"
              disabled={usedUp}
              className={styles.askInput}
            />
            <button
              type="submit"
              className={`button-ink ${styles.askButton}`}
              disabled={usedUp || asking !== null || draft.trim() === ""}
            >
              ask
            </button>
          </form>
          {usedUp ? (
            <>
              <p className={styles.askNote} role="status">
                {questionsUsedUpNote(COURSE_CREDIT.chatQuestions)}
              </p>
              <BuyCourse from="/" />
            </>
          ) : (
            left !== null &&
            left < SHOW_QUESTIONS_LEFT_BELOW && (
              <p className={styles.askNote}>{questionsLeftNote(left)}</p>
            )
          )}
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function AskHeading() {
  return (
    <div className={styles.askHead}>
      <Mascot size={40} />
      <h2 id="ask-heading" className={styles.askTitle}>
        Ask your teacher
      </h2>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  return (
    <span className={styles.chatBubble}>
      {message.parts.map((part, i) =>
        "text" in part ? (
          <span key={i}>{part.text}</span>
        ) : (
          <sup key={i} className={styles.cite}>
            <a
              href={part.cite.url}
              target="_blank"
              rel="noopener noreferrer"
              title={part.cite.title}
              aria-label={`Source ${part.cite.number}: ${part.cite.title}`}
            >
              [{part.cite.number}]
            </a>
          </sup>
        ),
      )}
      {message.community && <CommunityTip community={message.community} />}
    </span>
  );
}

function CommunityTip({ community }: { community: CommunityEntry }) {
  return (
    <span className={styles.chatCommunity}>
      <span className={styles.chatCommunityKicker}>Practise with people</span>
      {community.url ? (
        <a href={community.url} target="_blank" rel="noopener noreferrer">
          {community.name} ↗
        </a>
      ) : (
        <span className={styles.chatCommunityName}>{community.name}</span>
      )}
      <span className={styles.chatCommunityWhere}>{community.where}</span>
    </span>
  );
}
