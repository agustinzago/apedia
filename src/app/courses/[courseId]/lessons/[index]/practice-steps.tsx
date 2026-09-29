"use client";

import { useId, useState, useSyncExternalStore } from "react";
import styles from "./lesson.module.css";

/** Told when this tab changes a practice's ticks; other tabs hear "storage". */
const TICKED = "apedia:practice";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(TICKED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TICKED, onChange);
  };
}

function readTicks(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The practice's steps as checkboxes the Learner ticks off as they go. The
 * ticks are a convenience kept in this browser only: nothing the Teacher
 * weighs, so nothing is saved, and they work in the Example courses too.
 */
export function PracticeSteps({ storageKey, steps }: { storageKey: string; steps: string[] }) {
  const id = useId();
  const stored = useSyncExternalStore(
    subscribe,
    () => readTicks(storageKey),
    () => null,
  );
  // Where storage is blocked, the ticks live in the page only.
  const [unsaved, setUnsaved] = useState<boolean[] | null>(null);
  const done = unsaved ?? parseTicks(stored, steps.length);

  function toggle(index: number, checked: boolean) {
    const next = done.map((d, i) => (i === index ? checked : d));
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(TICKED));
    } catch {
      setUnsaved(next);
    }
  }

  return (
    <ol className={styles.steps}>
      {steps.map((step, i) => (
        <li key={step} className={styles.step}>
          <input
            id={`${id}-${i}`}
            type="checkbox"
            className={styles.box}
            checked={done[i]}
            onChange={(event) => toggle(i, event.target.checked)}
          />
          <label htmlFor={`${id}-${i}`} className={styles.stepText}>
            {step}
          </label>
        </li>
      ))}
    </ol>
  );
}

function parseTicks(stored: string | null, length: number): boolean[] {
  let saved: unknown = null;
  try {
    saved = JSON.parse(stored ?? "null");
  } catch {
    // Unreadable: start unticked.
  }
  return Array.from({ length }, (_, i) => Array.isArray(saved) && saved[i] === true);
}
