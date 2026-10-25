import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser, newId } from "./helpers";

describe("attachments (20260101000074)", () => {
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

  async function entry(orgId: string): Promise<string> {
    const id = newId();
    await client.query("insert into journal_entries (id, organization_id, entry_date, memo) values ($1, $2, current_date, 'Bill 1')", [id, orgId]);
    return id;
  }

  async function setup() {
    const orgId = await createOrg(client);
    const otherOrg = await createOrg(client, "Other");
    const owner = await createUser(client, "owner@example.com");
    const viewer = await createUser(client, "viewer@example.com");
    const outsider = await createUser(client, "outsider@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, viewer, "viewer");
    await addMember(client, otherOrg, outsider, "owner");
    return { orgId, otherOrg, owner, viewer, outsider, entryId: await entry(orgId), otherEntry: await entry(otherOrg) };
  }

  async function as(userId: string) {
    await client.query("RESET ROLE");
    await asUser(client, userId);
  }

  async function fails(sql: string, params: unknown[]): Promise<string> {
    await client.query("SAVEPOINT attempt");
    try {
      await client.query(sql, params);
      return "";
    } catch (err) {
      return (err as Error).message;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }
  }

  const pdf = Buffer.from("%PDF-1.4 receipt");
  const insert =
    "insert into attachments (organization_id, journal_entry_id, file_name, content_type, size_bytes, data) values ($1, $2, 'r.pdf', $3, $4, $5)";

  it("lets a writer attach a file that members can read and other books can't", async () => {
    const s = await setup();
    await as(s.owner);
    await client.query(insert, [s.orgId, s.entryId, "application/pdf", pdf.length, pdf]);

    await as(s.viewer);
    const { rows } = await client.query("select data from attachments where journal_entry_id = $1", [s.entryId]);
    expect(Buffer.from(rows[0].data).toString()).toBe("%PDF-1.4 receipt");
    expect(await fails(insert, [s.orgId, s.entryId, "application/pdf", pdf.length, pdf])).toMatch(/row-level security/);

    await as(s.outsider);
    expect((await client.query("select id from attachments")).rows).toHaveLength(0);
  });

  it("refuses another book's entry, an unknown type, and a size that doesn't match", async () => {
    const s = await setup();
    await as(s.owner);
    expect(await fails(insert, [s.orgId, s.otherEntry, "application/pdf", pdf.length, pdf])).toMatch(/same organization/);
    expect(await fails(insert, [s.orgId, s.entryId, "text/html", pdf.length, pdf])).toMatch(/check constraint/);
    expect(await fails(insert, [s.orgId, s.entryId, "application/pdf", pdf.length + 1, pdf])).toMatch(/check constraint/);
  });

  it("goes when its entry is deleted", async () => {
    const s = await setup();
    await as(s.owner);
    await client.query(insert, [s.orgId, s.entryId, "application/pdf", pdf.length, pdf]);
    await client.query("RESET ROLE");
    await client.query("delete from journal_entries where id = $1", [s.entryId]);
    expect((await client.query("select id from attachments")).rows).toHaveLength(0);
  });
});
