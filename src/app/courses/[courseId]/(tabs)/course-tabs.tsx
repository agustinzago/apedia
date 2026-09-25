"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import styles from "./course.module.css";

const TABS = [
  { segment: null, label: "Path" },
  { segment: "reference-sheet", label: "Reference sheet" },
  { segment: "resources", label: "Resources" },
  { segment: "communities", label: "Communities" },
] as const;

export function CourseTabs({ courseId }: { courseId: string }) {
  const active = useSelectedLayoutSegment();

  return (
    <nav data-noprint aria-label="Course" className={styles.tabs}>
      {TABS.map(({ segment, label }) => {
        const current = segment === active;
        return (
          <Link
            key={label}
            href={`/courses/${courseId}${segment ? `/${segment}` : ""}`}
            aria-current={current ? "page" : undefined}
            className={styles.tab}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
