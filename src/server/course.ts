import { cache } from "react";
import { createCourseModule, type CourseModule } from "@/course";
import { getDb } from "@/db/client";
import { getViewer } from "./auth";
import { dailyLimitsFromEnv, spendAlarmFromEnv } from "./config";
import { createAppTeacher, createAppUrlFetcher } from "./teacher";

const globalForCourse = globalThis as unknown as {
  apediaCourse?: Promise<CourseModule>;
};

/** The app's `course` module, with the Example course in place. */
export function getCourse(): Promise<CourseModule> {
  if (!globalForCourse.apediaCourse) {
    const started = (async () => {
      const course: CourseModule = createCourseModule({
        db: await getDb(),
        // Every call to Claude is recorded, for the spend alarm.
        teacher: createAppTeacher({ recordCall: (call) => course.recordTeacherCall(call) }),
        fetchUrl: createAppUrlFetcher(),
        limits: dailyLimitsFromEnv(),
        spendAlarm: spendAlarmFromEnv(),
      });
      await course.ensureExampleCourse();
      return course;
    })();
    // A failed start (say, a schema behind the code) is tried again on the
    // next request, rather than failing every request until a restart.
    started.catch(() => {
      if (globalForCourse.apediaCourse === started) globalForCourse.apediaCourse = undefined;
    });
    globalForCourse.apediaCourse = started;
  }
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

/** The Reference sheet read model for whoever is asking, deduplicated within one request. */
export const loadReferenceSheet = cache(async (courseId: string) => {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  return course.readReferenceSheet(courseId, viewer);
});

/** The Resources tab for whoever is asking. */
export const loadResources = cache(async (courseId: string) => {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  return course.readResources(courseId, viewer);
});

/** The Communities tab for whoever is asking. */
export const loadCommunities = cache(async (courseId: string) => {
  const [course, viewer] = await Promise.all([getCourse(), getViewer()]);
  return course.readCommunities(courseId, viewer);
});
