import type { MetadataRoute } from "next";
import { SITE_URL } from "./site-url";

/** Crawl the public pages; skip the ones behind sign-in and the API. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/interview", "/purchase", "/sign-in", "/start"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
