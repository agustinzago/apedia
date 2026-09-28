"use client";

import { useState } from "react";
import styles from "./lesson.module.css";

/**
 * Finish, on once every question is answered. Finishing itself (Learning
 * records, Glossary, Up next) lands in a later ticket; until then it says so.
 */
export function FinishButton({ enabled }: { enabled: boolean }) {
  const [pressed, setPressed] = useState(false);
  return (
    <>
      {pressed && (
        <span className={styles.finishNote} role="status">
          Finishing a Lesson arrives soon. Your answers are saved.
        </span>
      )}
      <button
        type="button"
        className="button-ink"
        disabled={!enabled}
        onClick={() => setPressed(true)}
      >
        Finish
      </button>
    </>
  );
}
