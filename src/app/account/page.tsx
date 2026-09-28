import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConfirmDelete } from "@/components/confirm-delete";
import { auth } from "@/server/auth";
import { deleteAccount } from "./actions";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Your account · Apedia" };

export default async function AccountPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/sign-in?next=/account");

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>
        <span className="highlight">Your account</span>
      </h1>
      <p className={styles.email}>
        Signed in as <strong>{email}</strong>
      </p>
      <section aria-labelledby="delete-account" className={styles.section}>
        <h2 id="delete-account" className={styles.sectionTitle}>
          Delete account
        </h2>
        <p className={styles.lede}>
          Removes your account and everything in it: every Course, Interview,
          Lesson and Learning record. You’ll be signed out.
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
