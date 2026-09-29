import type { Metadata } from "next";
import Link from "next/link";
import { COURSE_CREDIT } from "@/course";
import { operatorFromEnv } from "@/server/config";
import styles from "../small-print.module.css";

export const metadata: Metadata = { title: "Terms · Apedia" };

export default function TermsPage() {
  const { name, contactEmail } = operatorFromEnv();
  const { priceUsd, lessons, chatQuestions } = COURSE_CREDIT;

  return (
    <>
      <h1 className={styles.title}>
        <span className="highlight">Terms</span>
      </h1>
      <p className={styles.updated}>Last updated 29 September 2026</p>
      <p className={styles.lede}>
        The rules for using Apedia, kept short. By signing in you agree to
        them.
      </p>

      <section aria-labelledby="who-we-are" className={styles.section}>
        <h2 id="who-we-are" className={styles.sectionTitle}>
          Who runs Apedia
        </h2>
        <p>
          Apedia is run by {name} (“we”). Write to us at{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </section>

      <section aria-labelledby="age" className={styles.section}>
        <h2 id="age" className={styles.sectionTitle}>
          13 and over
        </h2>
        <p>
          You must be 13 or older to sign in. If you’re under 18, a parent or
          guardian should agree to these terms with you and make any purchase.
        </p>
      </section>

      <section aria-labelledby="credits" className={styles.section}>
        <h2 id="credits" className={styles.sectionTitle}>
          Course credits
        </h2>
        <p>
          A Course credit costs US${priceUsd} and buys one Course: up to{" "}
          {lessons} Lessons and {chatQuestions} questions to the Teacher. You
          need one to start the Interview, and it is used when you ask the
          Teacher to write the Course. If the Teacher turns the subject down,
          or fails to prepare the Course before finding any sources and you
          delete it, the credit is yours again. The Example course is free to
          read.
        </p>
        <p>
          Credits are sold by Polar, our merchant of record: Polar takes the
          payment, handles any sales tax and sends your receipt. See the{" "}
          <Link href="/refunds">Refund policy</Link> for when you get your
          money back.
        </p>
      </section>

      <section aria-labelledby="teacher" className={styles.section}>
        <h2 id="teacher" className={styles.sectionTitle}>
          The Teacher is an AI
        </h2>
        <p>
          Lessons, quizzes and answers are written by Claude, an AI model made
          by Anthropic, from the Resources they cite. They can be wrong or out
          of date. Check anything important against the Resources, and don’t
          rely on Apedia for medical, legal or financial decisions.
        </p>
      </section>

      <section aria-labelledby="your-words" className={styles.section}>
        <h2 id="your-words" className={styles.sectionTitle}>
          Your words and your Courses
        </h2>
        <p>
          What you write stays yours. You let us keep it and share it with the
          services named in <Link href="/privacy">Privacy</Link>, only to run
          Apedia. You can delete it all from{" "}
          <Link href="/account">Your account</Link>.
        </p>
      </section>

      <section aria-labelledby="fair-use" className={styles.section}>
        <h2 id="fair-use" className={styles.sectionTitle}>
          Fair use
        </h2>
        <p>
          Use Apedia to learn. Don’t try to break it, overload it or use it to
          harm anyone. We may close an account that does.
        </p>
      </section>

      <section aria-labelledby="no-guarantees" className={styles.section}>
        <h2 id="no-guarantees" className={styles.sectionTitle}>
          No guarantees
        </h2>
        <p>
          Apedia is provided as it is. We work to keep it running and correct,
          but can’t promise it always will be. As far as the law allows, we
          aren’t liable for losses from using it. If we change these terms,
          the date at the top changes too.
        </p>
      </section>
    </>
  );
}
