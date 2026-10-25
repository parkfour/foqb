import type { NextConfig } from "next";
import packageJson from "./package.json";
import { resolveGitSha } from "./lib/version/git-sha";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile); Vercel
  // builds leave this unset.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Room for an invoice PDF sent by the email-invoices plugin.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // app/changelog reads it on each request; ship it with the server.
  outputFileTracingIncludes: { "/changelog": ["./CHANGELOG.md"] },
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_GIT_SHA: resolveGitSha(),
  },
};

export default nextConfig;
