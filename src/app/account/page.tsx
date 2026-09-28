import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConfirmDelete } from "@/components/confirm-delete";
import { BuyCourse } from "@/app/purchase/buy-course";
import { creditsLine } from "@/app/purchase/credits-line";
import { auth } from "@/server/auth";
import { loadCourseCredits } from "@/server/course";
import { deleteAccount } from "./actions";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Your account · Apedia" };

export default async function AccountPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/sign-in?next=/account");
  const credits = await loadCourseCredits();

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>
        <span className="highlight">Your account</span>
      </h1>
      <p className={styles.email}>
        Signed in as <strong>{email}</strong>
      </p>
      <section aria-labelledby="course-credits" className={styles.section}>
        <h2 id="course-credits" className={styles.sectionTitle}>
          Course credits
        </h2>
        <p className={styles.lede}>{creditsLine(credits?.available ?? 0)}</p>
        <BuyCourse from="/account" />
      </section>
      <section aria-labelledby="delete-account" className={styles.section}>
        <h2 id="delete-account" className={styles.sectionTitle}>
          Delete account
        </h2>
        <p className={styles.lede}>
          Removes your account and everything in it: every Course, Interview,
          Lesson and Learning record, and your Course credits (ask for a
          refund of unused ones first). You’ll be signed out.
        </p>
        <ConfirmDelete
          label="Delete account"
          warning="Delete your account and all your Courses for good? This can’t be undone."
          confirmLabel="Yes, delete everything"
          action={deleteAccount}
        />
      </section>
    </main>
  );
}
