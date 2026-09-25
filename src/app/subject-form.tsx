"use client";

import { useState } from "react";
import styles from "./home.module.css";

const SUGGESTIONS = ["Music theory", "Chess", "Astronomy", "Spanish", "Drawing"];

export function SubjectForm() {
  const [subject, setSubject] = useState("");

  return (
    <form
      className={styles.form}
      // Starting an Interview arrives with its own ticket; Begin does nothing yet.
      onSubmit={(event) => event.preventDefault()}
    >
      <div className={styles.inputRow}>
        <label htmlFor="subject" className="visually-hidden">
          What would you like to learn?
        </label>
        <input
          id="subject"
          name="subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="music theory, chess, the French revolution…"
          autoComplete="off"
          className={`sketchy ${styles.input}`}
        />
        <button type="submit" className="button-ink">
          Begin
        </button>
      </div>
      <div className={styles.chips}>
        {SUGGESTIONS.map((label) => (
          <button
            key={label}
            type="button"
            className="chip"
            onClick={() => setSubject(label)}
          >
            {label}
          </button>
        ))}
      </div>
    </form>
  );
}
