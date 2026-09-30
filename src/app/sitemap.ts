import type { MetadataRoute } from "next";
import { EXAMPLE_COURSE_CARDS } from "@/course";
import { SITE_URL } from "./site-url";

/** The public pages: home, the small print, and every Example course page. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/pricing",
    "/terms",
    "/privacy",
    "/refunds",
    "/credits",
    ...EXAMPLE_COURSE_CARDS.flatMap((c) => [
      `/courses/${c.id}`,
      `/courses/${c.id}/resources`,
      `/courses/${c.id}/reference-sheet`,
      `/courses/${c.id}/communities`,
      ...c.lessons.map((l) => `/courses/${c.id}/lessons/${l.index}`),
    ]),
  ];
  return paths.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}` }));
}
