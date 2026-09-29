import styles from "./small-print.module.css";

/** Pricing, Privacy, Terms, Refund policy and Credits: plain pages that print cleanly. */
export default function SmallPrintLayout({ children }: LayoutProps<"/">) {
  return <main className={styles.main}>{children}</main>;
}
