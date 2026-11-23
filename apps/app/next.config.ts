import type { NextConfig } from "next";
import { assertBuildPublishableKey } from "./lib/supabase-key";

// Fail the build rather than inline a secret key into the public bundle.
assertBuildPublishableKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
