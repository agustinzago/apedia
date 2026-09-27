"use client";

import styles from "./reference-sheet.module.css";

export function PrintButton() {
  return (
    <button
      type="button"
      data-noprint
      className={`sketchy ${styles.print}`}
      onClick={() => window.print()}
    >
      Print
    </button>
  );
}
