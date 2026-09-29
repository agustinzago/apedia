import type { Metadata } from "next";
import Link from "next/link";
import { safeNext } from "@/auth";
import { subjectIn } from "@/app/interview/subject";
import { Mascot } from "@/components/mascot";
import { operatorFromEnv } from "@/server/config";
import { loadInterviewStart } from "@/server/course";
import { RefreshWhileWaiting } from "./refresh-while-waiting";
import styles from "../purchase.module.css";

export const metadata: Metadata = { title: "Thanks · Apedia" };

/**
 * Where the checkout sends the Learner after paying. It grants nothing:
 * the Course credit arrives through the payment webhook, usually within
 * seconds. Until it has, the page says so and checks again; then it leads
 * on to `next`, such as the Interview on the subject they typed.
 */
export default async function ThanksPage({ searchParams }: PageProps<"/purchase/thanks">) {
  const [params, start] = await Promise.all([searchParams, loadInterviewStart()]);
  const { contactEmail } = operatorFromEnv();
  const next = safeNext(params.next);
  const subject = subjectIn(next);
  const arrived = start !== null && start.creditsToStart > 0;

  return (
    <main className={styles.main}>
      <Mascot size={88} />
      <h1 className={styles.title}>
        Thanks, let’s <span className="highlight">start</span>
      </h1>
      {arrived ? (
        <>
          <p className={styles.lede}>
            Your Course credit is here. Your receipt is on its way by email.
          </p>
          <Link href={subject ? next : "/"} className={`button-ink ${styles.start}`}>
            {subject ? `Start your course on ${subject}` : "Choose what to learn"}
          </Link>
        </>
      ) : (
        <>
          <RefreshWhileWaiting />
          <p className={styles.lede} role="status">
            We’re confirming your payment. It usually takes a few seconds, and
            this page moves on by itself. Your receipt is on its way by email.
          </p>
          <Link href={`/purchase/thanks?${new URLSearchParams({ next })}`} className={styles.small}>
            Check again
          </Link>
        </>
      )}
      <p className={styles.small}>
        Nothing after a few minutes? Write to{" "}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </p>
    </main>
  );
}
