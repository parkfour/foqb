import { timingSafeEqual } from "node:crypto";

// Gate for the manual cron trigger routes. An unset CRON_SECRET must fail
// closed — comparing against `Bearer ${undefined}` let anyone in with the
// literal header "Bearer undefined".
export function isCronAuthorized(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authHeader);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
