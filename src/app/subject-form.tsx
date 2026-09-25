import Form from "next/form";
import Link from "next/link";
import styles from "./home.module.css";

const SUGGESTIONS = ["Music theory", "Chess", "Astronomy", "Spanish", "Drawing"];

/** Begin, or a suggestion chip, starts the Interview on that subject. */
export function SubjectForm() {
  return (
    <Form action="/interview" className={styles.form}>
      <div className={styles.inputRow}>
        <label htmlFor="subject" className="visually-hidden">
          What would you like to learn?
        </label>
        <input
          id="subject"
          name="subject"
          required
          maxLength={120}
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
          <Link
            key={label}
            href={`/interview?${new URLSearchParams({ subject: label })}`}
            className="chip"
          >
            {label}
          </Link>
        ))}
      </div>
    </Form>
  );
}
