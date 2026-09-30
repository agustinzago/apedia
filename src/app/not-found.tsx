import type { Metadata } from "next";
import Link from "next/link";
import styles from "./home.module.css";

export const metadata: Metadata = { title: "Page not found · Apedia" };

export default function NotFound() {
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <h1 className={styles.sectionTitle}>This page isn’t in the notebook.</h1>
        <Link href="/" className={styles.example}>
          go home
        </Link>
      </section>
    </main>
  );
}
