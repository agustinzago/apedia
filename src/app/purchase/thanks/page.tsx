import type { Metadata } from "next";
import Link from "next/link";
import { Mascot } from "@/components/mascot";
import { operatorFromEnv } from "@/server/config";
import styles from "../purchase.module.css";

export const metadata: Metadata = { title: "Thanks · Apedia" };

/**
 * Where the checkout sends the Learner after paying. It grants nothing:
 * the Course credit arrives through the payment webhook, usually within
 * seconds, and shows on the home page.
 */
export default function ThanksPage() {
  const { contactEmail } = operatorFromEnv();

  return (
    <main className={styles.main}>
      <Mascot size={88} />
      <h1 className={styles.title}>
        Thanks, let’s <span className="highlight">start</span>
      </h1>
      <p className={styles.lede}>
        Your Course credit appears on your home page as soon as the payment is
        confirmed, usually within a minute. Your receipt is on its way by email.
      </p>
      <Link href="/" className={`button-ink ${styles.start}`}>
        Choose what to learn
      </Link>
      <p className={styles.small}>
        Not there after a few minutes? Reload the home page, or write to{" "}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </p>
    </main>
  );
}
