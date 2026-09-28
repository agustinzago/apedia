"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { Question } from "@/course";
import { answerQuestion } from "./actions";
import styles from "./lesson.module.css";

type OptionState = "open" | "right" | "wrong" | "faded";

/**
 * Check yourself. Picking an option locks the question and shows feedback
 * straight away. The pick is saved as a quiz attempt; in the read-only
 * Example course it is kept in the page only.
 */
export function Quiz({
  courseId,
  lessonIndex,
  questions,
  answers,
  finished,
  readOnly,
}: {
  courseId: string;
  lessonIndex: number;
  questions: Question[];
  answers: { questionIndex: number; chosenOption: number }[];
  finished: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<(number | null)[]>(() =>
    questions.map(
      (_, i) => answers.find((a) => a.questionIndex === i)?.chosenOption ?? null,
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const choose = (questionIndex: number, option: number | null) =>
    setChosen((prev) => prev.map((c, i) => (i === questionIndex ? option : c)));

  async function pick(questionIndex: number, option: number) {
    if (chosen[questionIndex] !== null) return;
    choose(questionIndex, option);
    if (readOnly) return;

    setError(null);
    const saved = await answerQuestion(courseId, lessonIndex, questionIndex, option).catch(
      () => ({ ok: false as const, error: "Your answer couldn’t be saved. Check your connection and pick again." }),
    );
    if (!saved.ok) {
      choose(questionIndex, null);
      setError(saved.error);
      return;
    }
    // A question locks on its first answer; show that one.
    if (saved.chosenOption !== option) choose(questionIndex, saved.chosenOption);
    // The Finish bar reads the saved answers.
    router.refresh();
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
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
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
