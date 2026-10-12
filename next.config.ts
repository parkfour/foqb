import type { NextConfig } from "next";
import packageJson from "./package.json";
import { resolveGitSha } from "./lib/version/git-sha";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile); Vercel
  // builds leave this unset.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_GIT_SHA: resolveGitSha(),
  },
};

export default nextConfig;
