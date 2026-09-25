import Link from "next/link";
import styles from "./site-header.module.css";

export function SiteHeader() {
  return (
    <header data-noprint className={styles.header}>
      <Link href="/" className={styles.logo}>
        Ape<span className="highlight">dia</span>
      </Link>
    </header>
  );
}
