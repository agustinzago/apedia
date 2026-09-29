"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { requestMagicLink, type SignInState } from "./actions";
import styles from "./sign-in.module.css";

const idle: SignInState = { status: "idle" };

/** `next` is where the magic link returns to, such as the Interview. */
export function SignInPanel({ next }: { next: string }) {
  // Remounting the form clears its state after "Go back".
  const [attempt, setAttempt] = useState(0);
  return (
    <SignInForm key={attempt} next={next} onStartOver={() => setAttempt((n) => n + 1)} />
  );
}

function SignInForm({ next, onStartOver }: { next: string; onStartOver: () => void }) {
  const [state, action, pending] = useActionState(requestMagicLink, idle);

  if (state.status === "under-13") {
    return (
      <section className={`sticky-note ${styles.notYet}`} aria-live="polite">
        <h2 className={styles.notYetTitle}>Apedia isn’t available to you yet</h2>
        <p>
          Apedia is made for people aged 13 and over, so we can’t make you an
          account just now. We’d love to learn with you when you’re older.
        </p>
        <p>
          Until then, you’re welcome to look around the{" "}
          <Link href="/#examples">Example courses</Link>.
        </p>
        <button type="button" className={styles.textButton} onClick={onStartOver}>
          Go back
        </button>
      </section>
    );
  }

  const email = state.status === "idle" ? "" : state.email;
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className={styles.label}>
        Your email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        defaultValue={email}
        placeholder="you@example.com"
        aria-invalid={state.status === "invalid-email" || undefined}
        aria-describedby="sign-in-message"
        className={`sketchy ${styles.input}`}
      />
      <label className={styles.check}>
        <input type="checkbox" name="over13" className={styles.checkbox} />
        I’m 13 or older
      </label>
      <p className={styles.small}>
        Signing in means you accept the{" "}
        <Link href="/terms" target="_blank">Terms</Link> and{" "}
        <Link href="/privacy" target="_blank">Privacy</Link> policy.
      </p>
      <button type="submit" className="button-ink" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p id="sign-in-message" className={styles.message} aria-live="polite">
        {state.status === "invalid-email" &&
          "That doesn’t look like an email address. Check it and try again."}
        {state.status === "too-many-links" &&
          "We’ve sent several links to this address already; check your inbox and spam folder, or try again in an hour."}
        {state.status === "failed" &&
          "We couldn’t send your link just now. Please try again in a moment."}
      </p>
    </form>
  );
}
