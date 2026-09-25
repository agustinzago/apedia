"use client";

import { useId, useState } from "react";
import type { Question } from "@/course";
import styles from "./lesson.module.css";

type OptionState = "open" | "right" | "wrong" | "faded";

/**
 * Check yourself. Picking an option locks the question and shows feedback
 * straight away. Answers are kept in the page only; nothing is saved yet.
 */
export function Quiz({
  questions,
  answers,
  finished,
}: {
  questions: Question[];
  answers: { questionIndex: number; chosenOption: number }[];
  finished: boolean;
}) {
  const [chosen, setChosen] = useState<(number | null)[]>(() =>
    questions.map(
      (_, i) => answers.find((a) => a.questionIndex === i)?.chosenOption ?? null,
    ),
  );

  function pick(questionIndex: number, option: number) {
    setChosen((prev) =>
      prev[questionIndex] === null
        ? prev.map((c, i) => (i === questionIndex ? option : c))
        : prev,
    );
  }

  return (
    <section aria-labelledby="quiz-heading" className={styles.block}>
      <div className={styles.quizHead}>
        <h2 id="quiz-heading" className={styles.sectionTitle}>
          Check yourself
        </h2>
        <span className={styles.quizHint}>
          {finished
            ? "the answers given when this Lesson was finished"
            : "from memory, without looking back"}
        </span>
      </div>
      <ol className={styles.questions}>
        {questions.map((q, i) => (
          <QuestionCard
            key={q.question}
            number={i + 1}
            question={q}
            chosen={chosen[i]}
            onPick={(option) => pick(i, option)}
          />
        ))}
      </ol>
    </section>
  );
}

function QuestionCard({
  number,
  question,
  chosen,
  onPick,
}: {
  number: number;
  question: Question;
  chosen: number | null;
  onPick: (option: number) => void;
}) {
  const id = useId();
  const answered = chosen !== null;
  const right = chosen === question.answer;

  const stateOf = (option: number): OptionState =>
    !answered
      ? "open"
      : option === question.answer
        ? "right"
        : option === chosen
          ? "wrong"
          : "faded";

  return (
    <li className={`sketchy ${styles.question}`}>
      <div className={styles.questionHead}>
        <span className={styles.questionNumber} aria-hidden>
          {number}.
        </span>
        <span id={id} className={styles.questionText}>
          {question.question}
        </span>
        {question.review && <span className={styles.reviewTag}>review</span>}
      </div>
      <div role="group" aria-labelledby={id} className={styles.options}>
        {question.options.map((option, oi) => {
          const state = stateOf(oi);
          return (
            <button
              key={option}
              type="button"
              disabled={answered}
              aria-pressed={oi === chosen}
              data-state={state}
              className={styles.option}
              onClick={() => onPick(oi)}
            >
              <span>{option}</span>
              <span className={styles.optionMark} aria-hidden>
                {state === "right" ? "✓" : state === "wrong" ? "✗" : ""}
              </span>
              {state === "right" && (
                <span className="visually-hidden"> (correct answer)</span>
              )}
            </button>
          );
        })}
      </div>
      <p
        aria-live="polite"
        className={`${styles.feedback} ${right ? styles.feedbackRight : styles.feedbackWrong}`}
      >
        {answered &&
          `${right ? "✓ Correct." : "✗ Not quite."} ${question.explanation}`}
      </p>
    </li>
  );
}
