import type { ReactNode } from "react";
import { PageTransition } from "@/components/page-transition";

/** Remounted on every navigation below it, so the page animates in and out. */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
