import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadCoursePath } from "@/server/course";
import { CourseTabs } from "./course-tabs";
import styles from "./course.module.css";

export async function generateMetadata({
  params,
}: LayoutProps<"/courses/[courseId]">): Promise<Metadata> {
  const course = await loadCoursePath((await params).courseId);
  return course ? { title: `${course.title} · Apedia` } : {};
}

export default async function CourseLayout({
  children,
  params,
}: LayoutProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const course = await loadCoursePath(courseId);
  if (!course) notFound();

  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <span className={styles.subject}>
          {course.subject}
          {course.isExample && (
            <span className={styles.exampleTag}>
              Example course · read-only
            </span>
          )}
          {course.status === "done" && (
            <span className={styles.doneTag}>Done ✓</span>
          )}
        </span>
        <h1 className={styles.title}>{course.title}</h1>
      </div>
      <CourseTabs courseId={course.id} />
      {children}
    </main>
  );
}
