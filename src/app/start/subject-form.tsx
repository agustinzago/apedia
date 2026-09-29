import Form from "next/form";
import Link from "next/link";
import styles from "./start.module.css";

const SUGGESTIONS = ["Music theory", "Vegetable gardening", "Phone photography", "Chess", "Spanish"];

/**
 * Begin, or a suggestion chip, heads for the Interview on that subject. The
 * Interview page sends a visitor to sign in, and a Learner with no Course
 * credit free to buy a Course, first; the subject rides along in the URL.
 */
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
          placeholder="bread baking, chess, the French revolution…"
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
