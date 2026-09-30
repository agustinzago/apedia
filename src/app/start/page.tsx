import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { COURSE_CREDIT } from "@/course";
import { shortSubject } from "@/course/short-subject";
import { Mascot } from "@/components/mascot";
import { loadInterviewStart } from "@/server/course";
import { openInterviewPath } from "../interview/subject";
import { BuyCourse } from "../purchase/buy-course";
import { creditsLine } from "../purchase/credits-line";
import { SubjectForm } from "./subject-form";
import styles from "./start.module.css";

export const metadata: Metadata = { title: "Choose what to learn · Apedia" };

/**
 * Where "Buy a Course" leads: the Learner types what they want to learn,
 * which starts the Interview on it. A visitor signs in first; a Learner with
 * no Course credit free buys a Course here, and the checkout brings them back.
 * One whose credit an Interview is keeping may still type a subject: the
 * Interview page then offers to let that Interview go for it.
 */
export default async function StartPage() {
  const start = await loadInterviewStart();
  if (start === null) redirect(`/sign-in?${new URLSearchParams({ next: "/start" })}`);

  const credits = start.creditsToStart;
  return (
    <main className={styles.main}>
      {credits > 0 && <p className={styles.credit}>✓ {creditsLine(credits)} Ready to use.</p>}
      <Mascot size={110} preload />
      <h1 className={styles.title}>
        What would you like to <span className="highlight">learn</span>?
      </h1>
      {credits > 0 || start.openInterviews.length > 0 ? (
        <>
          <p className={styles.lede}>
            Anything at all. Next, your teacher asks four short questions about
            why, and writes your Course around the answers.
          </p>
          <SubjectForm />
        </>
      ) : (
        <>
          <p className={styles.lede}>
            First, a Course: US${COURSE_CREDIT.priceUsd} for the Interview, your
            Mission and up to {COURSE_CREDIT.lessons} Lessons written for you.
          </p>
          <BuyCourse from="/start" />
        </>
      )}
      {start.openInterviews.map((open) => (
        <Link key={open.id} href={openInterviewPath(open.id)} className={styles.openInterview}>
          Your Interview on {shortSubject(open.subject)} is waiting: continue it
        </Link>
      ))}
      <Link href="/#examples" className={styles.examples}>
        Not sure yet? Look inside the example Courses
      </Link>
    </main>
  );
}
