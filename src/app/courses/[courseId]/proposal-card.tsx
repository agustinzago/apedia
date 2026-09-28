"use client";

import { useActionState } from "react";
import type { ProposalView } from "@/course";
import { Mascot } from "@/components/mascot";
import { confirmProposal, declineProposal, type DecideState } from "./proposal-actions";
import styles from "./proposal.module.css";

/**
 * A Mission change or Done the Teacher proposes, as a clear choice: confirm
 * or "not now". Nothing changes until the Learner confirms.
 */
export function ProposalCard({
  courseId,
  proposal,
}: {
  courseId: string;
  proposal: ProposalView;
}) {
  const [confirmed, confirm, confirming] = useActionState(
    (): Promise<DecideState> =>
      confirmProposal(courseId, proposal.id).catch(() => ({
        decided: null,
        error: "That didn’t go through. Check your connection and try again.",
      })),
    { decided: null, error: null },
  );
  const [declined, decline, declining] = useActionState(
    (): Promise<DecideState> =>
      declineProposal(courseId, proposal.id).catch(() => ({
        decided: null,
        error: "That didn’t go through. Check your connection and try again.",
      })),
    { decided: null, error: null },
  );
  const decided = confirmed.decided ?? declined.decided;
  const error = confirmed.error ?? declined.error;
  const busy = confirming || declining;
  const isDone = proposal.kind === "done";
  const headingId = `proposal-${proposal.id}`;

  return (
    <section aria-labelledby={headingId} className={`sticky-note ${styles.card}`} data-noprint>
      <div className={styles.head}>
        <Mascot size={40} />
        <h2 id={headingId} className={`kicker ${styles.kicker}`}>
          {isDone ? "Are you done?" : "A new Mission?"}
        </h2>
      </div>
      <p className={styles.reason}>{proposal.reason}</p>

      {proposal.kind === "mission_change" ? (
        <dl className={styles.facts}>
          <dt>why</dt>
          <dd>{proposal.mission.why}</dd>
          <dt>success looks like</dt>
          <dd>
            <List items={proposal.mission.success} />
          </dd>
          <dt>constraints</dt>
          <dd>
            <List items={proposal.mission.constraints} />
          </dd>
          <dt>out of scope</dt>
          <dd>
            <List items={proposal.mission.outOfScope} />
          </dd>
        </dl>
      ) : (
        <ul className={styles.evidence}>
          {proposal.evidence.map((e) => (
            <li key={e.successItem}>
              <span className={styles.item}>✓ {e.successItem}</span>
              <span className={styles.records}>
                {e.records
                  .map((r) => `${String(r.number).padStart(4, "0")} ${r.title}`)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {decided ? (
        <p className={styles.note} role="status">
          {decided === "declined"
            ? "Kept as it is."
            : isDone
              ? "Course marked Done."
              : "Mission updated."}
        </p>
      ) : (
        <div className={styles.choices}>
          <form action={confirm}>
            <button type="submit" className="button-ink" disabled={busy}>
              {confirming
                ? "Saving…"
                : isDone
                  ? "Yes, I’m done"
                  : "Change my Mission"}
            </button>
          </form>
          <form action={decline}>
            <button type="submit" className={styles.notNow} disabled={busy}>
              {declining ? "Saving…" : "Not now"}
            </button>
          </form>
        </div>
      )}
      {!decided && !isDone && (
        <p className={styles.hint}>Nothing changes unless you confirm.</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <span className={styles.muted}>—</span>;
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
