import type { Metadata } from "next";
import Link from "next/link";
import { Mascot } from "@/components/mascot";
import styles from "../sign-in.module.css";

export const metadata: Metadata = { title: "Check your email · Apedia" };

export default function CheckEmailPage() {
  return (
    <main className={styles.main}>
      <Mascot size={88} />
      <h1 className={styles.title}>
        Check your <span className="highlight">email</span>
      </h1>
      <p className={styles.lede}>
        We’ve sent you a sign-in link. Open it on this device to carry on. It
        works once and expires in 24 hours.
      </p>
      <p className={styles.small}>
        Nothing arrived? Check your spam folder, or{" "}
        <Link href="/sign-in">ask for another link</Link>.
      </p>
    </main>
  );
}
