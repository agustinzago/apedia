import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CommunityEntry } from "@/course";
import { loadCommunities, loadCoursePath } from "@/server/course";
import styles from "../course.module.css";
import { NotForMe } from "./not-for-me";

export async function generateMetadata({
  params,
}: PageProps<"/courses/[courseId]/communities">): Promise<Metadata> {
  const course = await loadCoursePath((await params).courseId);
  return course ? { title: `Communities · ${course.title} · Apedia` } : {};
}

export default async function CommunitiesTab({
  params,
}: PageProps<"/courses/[courseId]/communities">) {
  const { courseId } = await params;
  const [tab, course] = await Promise.all([
    loadCommunities(courseId),
    loadCoursePath(courseId),
  ]);
  if (!tab || !course) notFound();

  return (
    <div className={styles.listTab}>
      <section aria-labelledby="communities-heading" className={styles.listSection}>
        <div className={styles.listHead}>
          <h2 id="communities-heading" className={styles.listTitle}>
            Practise with people
          </h2>
          {tab.canOptOut && <NotForMe courseId={course.id} optedOut={tab.optedOut} />}
        </div>
        {tab.optedOut ? (
          <p className={styles.listIntro}>
            You said Communities aren’t for you, so your teacher won’t point you
            to them. Turn off “Not for me” to see them again.
          </p>
        ) : (
          <>
            <p className={styles.listIntro}>
              Lessons give you knowledge and skill. Wisdom comes from trying it
              out in front of others — here’s where.
            </p>
            {tab.communities.length === 0 ? (
              <p className={styles.muted}>
                {course.preparing
                  ? "Your teacher is still looking for Communities for this Course."
                  : "No Communities yet."}
              </p>
            ) : (
              <ul className={styles.communityList}>
                {tab.communities.map((community, i) => (
                  <CommunityItem key={i} community={community} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CommunityItem({ community }: { community: CommunityEntry }) {
  return (
    <li className={`sticky-note ${styles.community}`}>
      <h3 className={styles.communityName}>
        {community.url ? (
          <a href={community.url} target="_blank" rel="noopener noreferrer">
            {community.name}
          </a>
        ) : (
          community.name
        )}
      </h3>
      <span className={styles.communityWhere}>
        {community.offline && <span className={styles.offlineTag}>offline</span>}
        {community.where}
      </span>
      <p className={styles.communityWhy}>{community.why}</p>
    </li>
  );
}
