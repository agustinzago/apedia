import { cache } from "react";
import { createCourseModule, type CourseModule } from "@/course";
import { getDb } from "@/db/client";

const globalForCourse = globalThis as unknown as {
  apediaCourse?: Promise<CourseModule>;
};

/** The app's `course` module, with the Example course in place. */
export function getCourse(): Promise<CourseModule> {
  globalForCourse.apediaCourse ??= (async () => {
    const course = createCourseModule({ db: await getDb() });
    await course.ensureExampleCourse();
    return course;
  })();
  return globalForCourse.apediaCourse;
}

/** The Path read model for a visitor, deduplicated within one request. */
export const loadCoursePath = cache(async (courseId: string) => {
  const course = await getCourse();
  // No sign-in yet: every viewer is a visitor.
  return course.readCoursePath(courseId, { learnerId: null });
});

/** The Lesson read model for a visitor, deduplicated within one request. */
export const loadLesson = cache(async (courseId: string, index: number) => {
  const course = await getCourse();
  return course.readLesson(courseId, index, { learnerId: null });
});
