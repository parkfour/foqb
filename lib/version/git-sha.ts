import { execSync } from "node:child_process";

// Three ways to learn the deployed commit, in priority order:
//
// 1. CI_GIT_SHA — set explicitly by the Gitea CI workflow via
//    `vercel deploy --build-env`. Needed because our deploys go through
//    plain `vercel deploy` from a Gitea Actions checkout, not Vercel's
//    native Git integration, so neither of the next two options actually
//    works in that pipeline (confirmed live: production showed "unknown"
//    until this was added) — the CLI doesn't upload `.git`, and
//    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA is only populated for deployments
//    Vercel's own Git integration triggers.
// 2. NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA — Vercel's own var, for the case
//    this ever does run through a Vercel-native Git integration instead.
// 3. A local `git rev-parse`, for `next dev`/local builds.
export function resolveGitSha(env: Record<string, string | undefined> = process.env): string {
  if (env.CI_GIT_SHA) {
    return env.CI_GIT_SHA;
  }
  if (env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) {
    return env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}
