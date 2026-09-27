import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/auth";
import { Mascot } from "@/components/mascot";
import { auth } from "@/server/auth";
import { SignInPanel } from "./sign-in-form";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Sign in · Apedia" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const next = safeNext(params.next);
  if (session?.user) redirect(next);
  const { error } = params;

  return (
    <main className={styles.main}>
      <Mascot size={88} />
      <h1 className={styles.title}>
        <span className="highlight">Sign in</span>
      </h1>
      <p className={styles.lede}>
        {next === "/interview"
          ? "Sign in and your teacher will write your course. Your answers are kept while you do."
          : "We’ll email you a link. Open it and you’re in: no password to remember."}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error === "Verification"
            ? "That sign-in link has expired or was already used. Ask for a new one below."
            : "Something went wrong signing you in. Please try again."}
        </p>
      )}
      <SignInPanel next={next} />
    </main>
  );
}
