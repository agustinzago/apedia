import Link from "next/link";
import { auth, signOut } from "@/server/auth";
import styles from "./site-header.module.css";

export async function SiteHeader() {
  const session = await auth();
  const email = session?.user?.email;

  return (
    <header data-noprint className={styles.header}>
      <Link href="/" className={styles.logo}>
        Ape<span className="highlight">dia</span>
      </Link>
      <div className={styles.account}>
        {email ? (
          <>
            <span className={styles.email}>{email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className={styles.link}>
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/sign-in" className={styles.link}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
