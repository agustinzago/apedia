import type { Metadata } from "next";
import { COURSE_CREDIT } from "@/course";
import { operatorFromEnv } from "@/server/config";
import styles from "../small-print.module.css";

export const metadata: Metadata = { title: "Refund policy · Apedia" };

export default function RefundsPage() {
  const { contactEmail } = operatorFromEnv();
  const { refundDays } = COURSE_CREDIT;

  return (
    <>
      <h1 className={styles.title}>
        <span className="highlight">Refund policy</span>
      </h1>
      <p className={styles.updated}>Last updated 28 September 2026</p>
      <p className={`sticky-note ${styles.lede} ${styles.note}`}>
        If a Course credit never got you a Course, ask within {refundDays}{" "}
        days and you’ll get your money back.
      </p>

      <section aria-labelledby="on-request" className={styles.section}>
        <h2 id="on-request" className={styles.sectionTitle}>
          Refunded on request
        </h2>
        <p>
          Within {refundDays} days of buying a Course credit, you get a full
          refund if its Course was never written. That covers a Course the
          Teacher failed to write, and a credit you never used.
        </p>
      </section>

      <section aria-labelledby="otherwise" className={styles.section}>
        <h2 id="otherwise" className={styles.sectionTitle}>
          Otherwise
        </h2>
        <p>
          Once a Course has been written, or after {refundDays} days, a refund
          is up to us. Tell us what went wrong and we’ll look at it fairly.
        </p>
      </section>

      <section aria-labelledby="how" className={styles.section}>
        <h2 id="how" className={styles.sectionTitle}>
          How to ask
        </h2>
        <p>
          Write to <a href={`mailto:${contactEmail}`}>{contactEmail}</a> from
          the email address you sign in with. Refunds are paid through Polar,
          which sold you the credit, back to the way you paid.
        </p>
      </section>
    </>
  );
}
