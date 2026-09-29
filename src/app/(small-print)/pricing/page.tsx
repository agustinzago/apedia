import type { Metadata } from "next";
import Link from "next/link";
import { COURSE_CREDIT } from "@/course";
import styles from "../small-print.module.css";

export const metadata: Metadata = { title: "Pricing · Apedia" };

/**
 * What a Course costs and what it includes, before anyone signs in. Every
 * number is COURSE_CREDIT's, the one `course` enforces.
 */
export default function PricingPage() {
  const { priceUsd, lessons, chatQuestions, refundDays } = COURSE_CREDIT;

  return (
    <>
      <h1 className={styles.title}>
        <span className="highlight">Pricing</span>
      </h1>
      <p className={`sticky-note ${styles.lede} ${styles.note}`}>
        A Course costs US${priceUsd}, paid once. It’s priced at cost, since
        Apedia doesn’t aim to profit.
      </p>

      <section aria-labelledby="includes" className={styles.section}>
        <h2 id="includes" className={styles.sectionTitle}>
          What a Course includes
        </h2>
        <ul className={styles.list}>
          <li>
            One subject and its Mission: the Teacher interviews you about why
            you want to learn it.
          </li>
          <li>Up to {lessons} Lessons written for you, each with verified Resources and a quiz.</li>
          <li>Up to {chatQuestions} questions to the Teacher across its Lessons.</li>
          <li>A printable Reference sheet that grows with every Lesson you finish.</li>
        </ul>
        <p>
          Once the Lessons or questions are used up, everything written stays
          yours to read. Another Course keeps you going on a new Mission.
        </p>
      </section>

      <section aria-labelledby="why-not-free" className={styles.section}>
        <h2 id="why-not-free" className={styles.sectionTitle}>
          Why it isn’t free
        </h2>
        <p>
          Every Lesson is written by an AI Teacher that costs money to run,
          and the price covers that.
        </p>
      </section>

      <section aria-labelledby="paying" className={styles.section}>
        <h2 id="paying" className={styles.sectionTitle}>
          Paying
        </h2>
        <p>
          You pay once for each Course, with no subscription. Polar takes the
          payment and sends your receipt. Sales tax or VAT may be added at
          checkout, depending on where you live.
        </p>
      </section>

      <section aria-labelledby="refunds" className={styles.section}>
        <h2 id="refunds" className={styles.sectionTitle}>
          Refunds
        </h2>
        <p>
          If your Course was never written, ask within {refundDays} days of
          buying and you get your money back. The{" "}
          <Link href="/refunds">Refund policy</Link> has the details.
        </p>
      </section>

      <section aria-labelledby="free-first" className={styles.section}>
        <h2 id="free-first" className={styles.sectionTitle}>
          See one first, free
        </h2>
        <p>
          The <Link href="/#examples">Example courses</Link> (Music theory,
          Vegetable gardening and Phone photography) are free to read, with no
          sign-in. When you’re ready, <Link href="/start">choose what to learn</Link>.
        </p>
      </section>
    </>
  );
}
