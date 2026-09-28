"use client";

import { useActionState } from "react";
import { setCommunityOptOut, type OptOutState } from "./actions";
import styles from "../course.module.css";

/** The "Not for me" toggle: pressed while the Learner has opted out of Communities. */
export function NotForMe({
  courseId,
  optedOut,
}: {
  courseId: string;
  optedOut: boolean;
}) {
  const [state, toggle, saving] = useActionState(
    (): Promise<OptOutState> => setCommunityOptOut(courseId, !optedOut),
    { error: null },
  );

  return (
    <form action={toggle} className={styles.optOut}>
      <button
        type="submit"
        aria-pressed={optedOut}
        disabled={saving}
        className={styles.optOutButton}
      >
        <span className={`sketchy-circle ${styles.optOutMark}`} aria-hidden>
          {optedOut ? "✓" : ""}
        </span>
        Not for me
      </button>
      {state.error && (
        <p className={styles.creationError} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
