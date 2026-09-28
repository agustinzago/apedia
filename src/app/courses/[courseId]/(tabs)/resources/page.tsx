import { notFound } from "next/navigation";
import type { LessonResource } from "@/course";
import { loadCoursePath, loadResources } from "@/server/course";
import styles from "../course.module.css";

export default async function ResourcesTab({
  params,
}: PageProps<"/courses/[courseId]/resources">) {
  const { courseId } = await params;
  const [tab, course] = await Promise.all([
    loadResources(courseId),
    loadCoursePath(courseId),
  ]);
  if (!tab || !course) notFound();

  return (
    <div className={styles.listTab}>
      <section aria-labelledby="resources-heading" className={styles.listSection}>
        <h2 id="resources-heading" className={styles.listTitle}>
          Trusted resources
        </h2>
        <p className={styles.listIntro}>
          Found and checked by your teacher. Lessons cite them by number.
        </p>
        {tab.resources.length === 0 ? (
          <p className={styles.muted}>
            {course.preparing
              ? "Your teacher is still finding Resources for this Course."
              : "No Resources yet."}
          </p>
        ) : (
          <ol className={styles.resourceList}>
            {tab.resources.map((resource) => (
              <ResourceItem key={resource.number} resource={resource} />
            ))}
          </ol>
        )}
      </section>

      {tab.gaps.length > 0 && (
        <section aria-labelledby="gaps-heading" className={styles.listSection}>
          <h2 id="gaps-heading" className={`kicker ${styles.gapsKicker}`}>
            Not covered yet
          </h2>
          <ul className={styles.gapList}>
            {tab.gaps.map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ResourceItem({ resource }: { resource: LessonResource }) {
  const site = siteName(resource.url);
  return (
    <li value={resource.number} className={`sketchy ${styles.resource}`}>
      <span className={styles.resourceNumber} aria-hidden>
        [{resource.number}]
      </span>
      <div className={styles.resourceBody}>
        <span className={styles.resourceMeta}>
          <span className={styles.kindTag}>{resource.kind}</span>
          <span>{resource.author}</span>
        </span>
        <h3 className={styles.resourceTitle}>{resource.title}</h3>
        <p className={styles.resourceWhy}>{resource.why}</p>
      </div>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${resource.title} on ${site}`}
        className={styles.resourceLink}
      >
        {site} ↗
      </a>
    </li>
  );
}

/** "https://www.musictheory.net/lessons" → "musictheory.net". */
function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
