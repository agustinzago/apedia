import { ViewTransition, type ReactNode } from "react";

/**
 * Animates what it wraps in and out as the Learner moves between pages:
 * links tagged `nav-forward` (deeper, such as into a Lesson) slide in from
 * the right, `nav-back` from the left, and any other navigation settles in
 * with a short fade and rise. Used by the `template.tsx` files, which Next
 * remounts on every navigation below them. Browsers without view
 * transitions swap pages as before.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/** Links into something deeper, such as a Course or a Lesson. */
export const FORWARD = ["nav-forward"];
/** Links back up, such as "← learning path". */
export const BACK = ["nav-back"];
