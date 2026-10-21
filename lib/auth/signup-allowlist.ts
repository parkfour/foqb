// Gates self-serve signup on instances that need it (e.g. a publicly
// reachable review/demo deployment) without touching the ones that don't —
// unset/empty allowlist means unrestricted, so foqb.parkfour.com's existing,
// already-tested open-signup behavior is unaffected by this feature existing
// at all. Comma-separated patterns, each either an exact email or a
// "*@domain" wildcard.
export function isEmailAllowed(email: string, allowlist: string | undefined): boolean {
  if (!allowlist || allowlist.trim() === "") {
    return true;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const patterns = allowlist
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);

  return patterns.some((pattern) => {
    if (pattern.startsWith("*@")) {
      const domain = pattern.slice(2);
      return normalizedEmail.endsWith(`@${domain}`);
    }
    return normalizedEmail === pattern;
  });
}
