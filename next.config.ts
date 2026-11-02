import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image runs the traced standalone server (DEL-4).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      // Tailwind for global stylesheets only: "as: *.css" would turn a *.module.css
      // into a plain stylesheet and drop its class-name exports.
      "*.css": {
        condition: { all: [{ not: "foreign" }, { not: { path: "*.module.css" } }] },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
