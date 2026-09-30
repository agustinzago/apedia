import type { NextConfig } from "next";
import { securityHeaders } from "./src/server/security-headers";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders({ dev: process.env.NODE_ENV === "development" }),
      },
    ];
  },
};

export default nextConfig;
