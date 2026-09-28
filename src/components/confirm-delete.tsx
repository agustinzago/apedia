"use client";

import { useActionState, useId, useState } from "react";
import styles from "./confirm-delete.module.css";

export type DeleteState = { error: string | null };

/**
 * A delete button that asks first: pressing it shows what will be lost and
 * a second button that deletes for good. On success the action navigates
 * away; it returns only to report an error.
 */
export function ConfirmDelete({
  label,
  warning,
  confirmLabel,
  action,
}: {
  label: string;
  /** What deleting removes, shown when asking. */
  warning: string;
  confirmLabel: string;
  action: () => Promise<DeleteState>;
}) {
  const [asking, setAsking] = useState(false);
  const [state, remove, deleting] = useActionState(
    (): Promise<DeleteState> =>
      action().catch(() => ({
        error: "That didn’t go through. Check your connection and try again.",
      })),
    { error: null },
  );
  const warningId = useId();

  if (!asking) {
    return (
      <button type="button" className={styles.start} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }

  return (
    <form action={remove} className={`sketchy ${styles.confirm}`} aria-describedby={warningId}>
      <p id={warningId} className={styles.warning}>
        {warning}
      </p>
      <div className={styles.buttons}>
        <button type="submit" className={styles.delete} disabled={deleting}>
          {deleting ? "Deleting…" : confirmLabel}
        </button>
        <button
          type="button"
          className={styles.cancel}
          disabled={deleting}
          onClick={() => setAsking(false)}
        >
          Keep it
        </button>
      </div>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
