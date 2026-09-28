import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { KeyIdea, ReferenceSection, Term } from "@/course";
import { loadReferenceSheet } from "@/server/course";
import { PrintButton } from "./print-button";
import styles from "./reference-sheet.module.css";

export async function generateMetadata({
  params,
}: PageProps<"/courses/[courseId]/reference-sheet">): Promise<Metadata> {
  const { courseId } = await params;
  const sheet = await loadReferenceSheet(courseId);
  return sheet ? { title: `Reference sheet · ${sheet.course.title} · Apedia` } : {};
}

export default async function ReferenceSheetTab({
  params,
}: PageProps<"/courses/[courseId]/reference-sheet">) {
  const { courseId } = await params;
  const sheet = await loadReferenceSheet(courseId);
  if (!sheet) notFound();

  const empty =
    sheet.glossary.length === 0 &&
    sheet.keyIdeas.length === 0 &&
    sheet.sections.length === 0;

  return (
    <article aria-labelledby="sheet-heading" className={styles.sheet}>
      <header className={styles.header}>
        <h2 id="sheet-heading" className={styles.title}>
          Reference sheet
        </h2>
        {!empty && <PrintButton />}
      </header>

      {empty ? (
        <p className={`sketchy ${styles.empty}`}>
          Nothing here yet. Finish a Lesson and its Key idea, and the words
          you’ve shown you understand, are written here, ready to print.
        </p>
      ) : (
        <>
          {sheet.keyIdeas.length > 0 && <KeyIdeas keyIdeas={sheet.keyIdeas} />}
          {sheet.glossary.length > 0 && <Glossary terms={sheet.glossary} />}
          {sheet.sections.map((section, i) => (
            <TopicSection key={i} section={section} />
          ))}
        </>
      )}
    </article>
  );
}

function KeyIdeas({ keyIdeas }: { keyIdeas: KeyIdea[] }) {
  return (
    <section
      aria-labelledby="key-ideas-heading"
      className={`sketchy-mirror ${styles.keyIdeas}`}
    >
      <h3 id="key-ideas-heading" className={`kicker ${styles.keyIdeasKicker}`}>
        Key ideas so far
      </h3>
      <ol className={styles.keyIdeaList}>
        {keyIdeas.map((idea) => (
          <li key={idea.number} className={styles.keyIdea}>
            <span className={styles.keyIdeaNumber}>{idea.number}</span>
            <span>
              {idea.text}
              <span className={styles.keyIdeaLesson}>
                {" "}
                — Lesson {idea.lessonIndex}: {idea.lessonTitle}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Glossary({ terms }: { terms: Term[] }) {
  return (
    <section aria-labelledby="glossary-heading">
      <h3 id="glossary-heading" className={styles.sectionTitle}>
        Glossary
      </h3>
      <dl className={styles.glossary}>
        {terms.map((t) => (
          <div key={t.term} className={styles.entry}>
            <dt className={styles.term}>{t.term}</dt>
            <dd className={styles.definition}>{t.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TopicSection({ section }: { section: ReferenceSection }) {
  return (
    <section className={`sketchy ${styles.topic}`}>
      <h3 className={styles.topicTitle}>{section.title}</h3>
      <p className={styles.topicBody}>{section.body}</p>
    </section>
  );
}
