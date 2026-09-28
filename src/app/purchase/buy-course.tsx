"use client";

import { useActionState } from "react";
import { COURSE_CREDIT } from "@/course/course-credit";
import { buyCourse, type BuyState } from "./actions";
import styles from "./purchase.module.css";

/** "Buy a Course · $5": off to the checkout, or a calm note saying why not. */
export function BuyCourse({ from }: { from: string }) {
  const [state, buy, pending] = useActionState<BuyState, FormData>(buyCourse, { error: null });

  return (
    <form action={buy} className={styles.buy}>
      <input type="hidden" name="from" value={from} />
      <button type="submit" className="button-ink" disabled={pending}>
        {pending ? "Opening checkout…" : `Buy a Course · $${COURSE_CREDIT.priceUsd}`}
      </button>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
