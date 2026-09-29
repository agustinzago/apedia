"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_MS = 3_000;
const GIVE_UP_AFTER_MS = 2 * 60_000;

/** Re-renders the page every few seconds for a while, until what it waits for has arrived. */
export function RefreshWhileWaiting() {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > GIVE_UP_AFTER_MS) clearInterval(timer);
      else router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
