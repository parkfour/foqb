import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { createAdminClientMock, cleanupUnclaimedMembersMock, cleanupRateLimitsMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  cleanupUnclaimedMembersMock: vi.fn(),
  cleanupRateLimitsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/cron/cleanup-unclaimed-members", () => ({
  cleanupUnclaimedMembers: cleanupUnclaimedMembersMock,
}));
vi.mock("@/lib/cron/cleanup-rate-limits", () => ({ cleanupRateLimits: cleanupRateLimitsMock }));
vi.mock("@/lib/recurring/generate", () => ({ RECURRING_INTERVAL_SECONDS: 3600, generateDueRecurring: vi.fn() }));
vi.mock("@/lib/plugins/events-outbox", () => ({ PLUGIN_EVENTS_INTERVAL_SECONDS: 60, deliverPluginEvents: vi.fn() }));

import { maybeRunDueCronJobs } from "@/lib/cron/piggyback";

beforeEach(() => {
  createAdminClientMock.mockReset();
  cleanupUnclaimedMembersMock.mockReset().mockResolvedValue({ checked: 0, deleted: 0, claimed: 0 });
  cleanupRateLimitsMock.mockReset().mockResolvedValue({ deleted: 0 });
});

describe("maybeRunDueCronJobs", () => {
  it("runs a job's cleanup function when the RPC claims it", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(true) });
    createAdminClientMock.mockReturnValue(client);

    await maybeRunDueCronJobs();

    expect(cleanupUnclaimedMembersMock).toHaveBeenCalledTimes(1);
    expect(cleanupRateLimitsMock).toHaveBeenCalledTimes(1);
  });

  it("skips both cleanup functions when neither job is claimed", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(false) });
    createAdminClientMock.mockReturnValue(client);

    await maybeRunDueCronJobs();

    expect(cleanupUnclaimedMembersMock).not.toHaveBeenCalled();
    expect(cleanupRateLimitsMock).not.toHaveBeenCalled();
  });

  it("calls claim_cron_run with each job's own name and interval", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(false) });
    createAdminClientMock.mockReturnValue(client);

    await maybeRunDueCronJobs();

    expect(client.rpc).toHaveBeenCalledWith("claim_cron_run", {
      p_job_name: "cleanup-unclaimed-members",
      p_min_interval_seconds: 24 * 60 * 60,
    });
    expect(client.rpc).toHaveBeenCalledWith("claim_cron_run", {
      p_job_name: "cleanup-rate-limits",
      p_min_interval_seconds: 60 * 60,
    });
  });

  it("does not let one job's cleanup failure stop the other job from running", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(true) });
    createAdminClientMock.mockReturnValue(client);
    cleanupUnclaimedMembersMock.mockRejectedValue(new Error("boom"));

    await maybeRunDueCronJobs();

    expect(cleanupRateLimitsMock).toHaveBeenCalledTimes(1);
  });
});
