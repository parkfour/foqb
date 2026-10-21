import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("MFA enforcement in the database", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function orgWithOwner(enrolled: boolean) {
    const orgId = await createOrg(client, "MFA Org");
    const userId = await createUser(client, "mfa@example.com");
    await addMember(client, orgId, userId, "owner");
    await createAccount(client, orgId);
    if (enrolled) {
      await client.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [userId]);
    }
    return { orgId, userId };
  }

  async function visibleAccounts(orgId: string): Promise<number> {
    const { rows } = await client.query("select id from accounts where organization_id = $1", [orgId]);
    return rows.length;
  }

  it("hides org data from an enrolled user's password-only (AAL1) session", async () => {
    const { orgId, userId } = await orgWithOwner(true);
    await asUser(client, userId);

    expect(await visibleAccounts(orgId)).toBe(0);
    const { rows: members } = await client.query("select * from get_org_members($1)", [orgId]);
    expect(members).toHaveLength(0);
    const { rows: self } = await client.query("select * from organization_members where user_id = $1", [userId]);
    expect(self).toHaveLength(0);
  });

  it("rejects writes from an enrolled user's AAL1 session", async () => {
    const { orgId, userId } = await orgWithOwner(true);
    await asUser(client, userId);

    await expect(
      client.query(
        "insert into journal_entries (organization_id, entry_date, status) values ($1, current_date, 'draft')",
        [orgId],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("allows an enrolled user once the session is AAL2", async () => {
    const { orgId, userId } = await orgWithOwner(true);
    await asUser(client, userId);
    await client.query("SET LOCAL request.jwt.claim.aal = 'aal2'");

    expect(await visibleAccounts(orgId)).toBe(1);
  });

  it("leaves users without a verified factor unaffected at AAL1", async () => {
    const { orgId, userId } = await orgWithOwner(false);
    await asUser(client, userId);

    expect(await visibleAccounts(orgId)).toBe(1);
  });
});
