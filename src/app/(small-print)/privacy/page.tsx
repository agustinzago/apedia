import type { Metadata } from "next";
import Link from "next/link";
import { operatorFromEnv } from "@/server/config";
import styles from "../small-print.module.css";

export const metadata: Metadata = { title: "Privacy · Apedia" };

export default function PrivacyPage() {
  const { name, contactEmail } = operatorFromEnv();

  return (
    <>
      <h1 className={styles.title}>
        <span className="highlight">Privacy</span>
      </h1>
      <p className={styles.updated}>Last updated 28 September 2026</p>
      <p className={styles.lede}>
        Apedia keeps only what it needs to teach you. This page says what that
        is, who helps us look after it, and how to remove it. Apedia is run by{" "}
        {name} (“we”).
      </p>

      <section aria-labelledby="what-we-keep" className={styles.section}>
        <h2 id="what-we-keep" className={styles.sectionTitle}>
          What Apedia keeps
        </h2>
        <ul className={styles.list}>
          <li>Your email address, so you can sign in.</li>
          <li>
            Your Interview answers: the subject, why you want to learn it, what
            you already know, what success looks like and how long you can
            study at a time.
          </li>
          <li>
            Your Courses: the Mission, Lessons, Resources, quiz answers,
            Learning records, Glossary and Reference sheet.
          </li>
          <li>The questions you ask the Teacher in a Lesson, and its answers.</li>
        </ul>
        <p>
          Apedia sets only the cookies it needs to work: one keeps you signed
          in, and one remembers an Interview you started before signing in.
          There are no advertising or tracking cookies.
        </p>
      </section>

      <section aria-labelledby="who-handles-it" className={styles.section}>
        <h2 id="who-handles-it" className={styles.sectionTitle}>
          Who handles it for us
        </h2>
        <ul className={styles.list}>
          <li>
            <strong>Vercel</strong> hosts Apedia: every page you open is served
            by it.
          </li>
          <li>
            <strong>Neon</strong> runs the database where everything above is
            kept.
          </li>
          <li>
            <strong>Resend</strong> sends your sign-in emails, so it sees your
            email address.
          </li>
          <li>
            <strong>Anthropic</strong> writes the Teacher’s words. Your
            Interview answers, Mission, quiz answers and questions are sent to
            its AI model, Claude, to write your Lessons and answers. Your email
            address is not sent.
          </li>
          <li>
            <strong>Polar</strong> takes payment for Course credits. It keeps
            your payment details; we never see your card.
          </li>
        </ul>
        <p>
          We use them only to run Apedia. We don’t sell your data or use it for
          advertising.
        </p>
      </section>

      <section aria-labelledby="age" className={styles.section}>
        <h2 id="age" className={styles.sectionTitle}>
          13 and over
        </h2>
        <p>
          Apedia is for people aged 13 and over. If you think someone younger
          has an account, write to us and we’ll delete it.
        </p>
      </section>

      <section aria-labelledby="deleting" className={styles.section}>
        <h2 id="deleting" className={styles.sectionTitle}>
          Deleting everything
        </h2>
        <p>
          On <Link href="/account">Your account</Link>, “Delete account”
          removes your account and everything Apedia holds about you: your
          email address, every Interview, Course, Lesson, question and Learning
          record. It happens at once and can’t be undone. Polar keeps its own
          record of any payment, as a seller must.
        </p>
      </section>

      <section aria-labelledby="contact" className={styles.section}>
        <h2 id="contact" className={styles.sectionTitle}>
          Questions
        </h2>
        <p>
          Write to <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </section>
    </>
  );
}
