import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mascot } from "@/components/mascot";
import { auth } from "@/server/auth";
import { SignInPanel } from "./sign-in-form";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Sign in · Apedia" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const [session, { error }] = await Promise.all([auth(), searchParams]);
  if (session?.user) redirect("/");

  return (
    <main className={styles.main}>
      <Mascot size={88} />
      <h1 className={styles.title}>
        <span className="highlight">Sign in</span>
      </h1>
      <p className={styles.lede}>
        We’ll email you a link. Open it and you’re in: no password to remember.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error === "Verification"
            ? "That sign-in link has expired or was already used. Ask for a new one below."
            : "Something went wrong signing you in. Please try again."}
        </p>
      )}
      <SignInPanel />
    </main>
  );
}
