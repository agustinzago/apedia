import { cache } from "react";
import { createCourseModule, type CourseModule } from "@/course";
import { getDb } from "@/db/client";
import { getViewer } from "./auth";
import { createAppTeacher, createAppUrlFetcher } from "./teacher";

const globalForCourse = globalThis as unknown as {
  apediaCourse?: Promise<CourseModule>;
};

/** The app's `course` module, with the Example course in place. */
export function getCourse(): Promise<CourseModule> {
  globalForCourse.apediaCourse ??= (async () => {
    const course = createCourseModule({
      db: await getDb(),
      teacher: createAppTeacher(),
      fetchUrl: createAppUrlFetcher(),
    });
    await course.ensureExampleCourse();
    return course;
  })();
  return globalForCourse.apediaCourse;
}

/** The Path read model for whoever is asking, deduplicated within one request. */
export const loadCoursePath = cache(async (courseId: string) => {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  return course.readCoursePath(courseId, viewer);
});

/** The signed-in Learner's own Courses, or null for a visitor. */
export const loadYourCourses = cache(async () => {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  if (viewer.learnerId === null) return null;
  return course.listCourses(viewer.learnerId);
});

/** The Lesson read model for whoever is asking, deduplicated within one request. */
export const loadLesson = cache(async (courseId: string, index: number) => {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  return course.readLesson(courseId, index, viewer);
});
