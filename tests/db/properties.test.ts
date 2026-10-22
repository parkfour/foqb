import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addMember, createAccount, createOrg, createUser, newId } from "./helpers";
import { removeBooks, restClientAs } from "./rest";

// The Properties actions, signed in through supabase-js against the real
// schema. Their values count in net worth and its history.
let currentClient: SupabaseClient;
let currentOrgId: string;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("@/lib/org/current", () => ({ getCurrentOrgId: async () => currentOrgId }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createPropertyAction, updatePropertyValueAction, deletePropertyAction } = await import(
  "@/app/(dashboard)/properties/actions"
);

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("properties", () => {
  let client: Client;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await removeBooks(client, orgIds, userIds);
    await client.end();
  });

  async function signIn(role: "owner" | "viewer", orgId?: string) {
    const userId = await createUser(client, `household-${newId()}@example.com`);
    const org = orgId ?? (await createOrg(client, "Household"));
    await addMember(client, org, userId, role);
    if (!orgId) orgIds.push(org);
    userIds.push(userId);
    currentClient = restClientAs(userId);
    currentOrgId = org;
    return org;
  }

  const property = async (orgId: string) =>
    (
      await client.query(
        "select id, name, address_city, purchase_price::float, purchase_date::text, estimated_value::float from properties where organization_id = $1",
        [orgId],
      )
    ).rows;

  it("adds a property valued at its purchase price until it's given an estimate", async () => {
    const orgId = await signIn("owner");

    await createPropertyAction(form({ name: " Cabin ", city: "Duluth", purchasePrice: "250000.004", purchaseDate: "2020-06-01" }));

    expect(await property(orgId)).toEqual([
      expect.objectContaining({
        name: "Cabin",
        address_city: "Duluth",
        purchase_price: 250000,
        purchase_date: "2020-06-01",
        estimated_value: 250000,
      }),
    ]);
  });

  it("updates the estimate, and ignores one that isn't an amount", async () => {
    const orgId = await signIn("owner");
    await createPropertyAction(form({ name: "Cabin", purchasePrice: "250000" }));
    const [{ id }] = await property(orgId);

    await updatePropertyValueAction(form({ propertyId: id, estimatedValue: "310000" }));
    await updatePropertyValueAction(form({ propertyId: id, estimatedValue: "-5" }));

    expect((await property(orgId))[0].estimated_value).toBe(310000);
  });

  it("removes a property, untagging the accounts that were its Schedule E lines", async () => {
    const orgId = await signIn("owner");
    await createPropertyAction(form({ name: "Cabin", purchasePrice: "250000" }));
    const [{ id }] = await property(orgId);
    const rent = await createAccount(client, orgId, { name: "Cabin rent", type: "revenue" });
    await client.query("update accounts set property_id = $2 where id = $1", [rent, id]);

    await deletePropertyAction(form({ propertyId: id }));

    expect(await property(orgId)).toEqual([]);
    const { rows } = await client.query("select property_id from accounts where id = $1", [rent]);
    expect(rows[0].property_id).toBeNull();
  });

  it("lets a viewer change nothing", async () => {
    const orgId = await signIn("owner");
    await createPropertyAction(form({ name: "Cabin", purchasePrice: "250000" }));
    const [{ id }] = await property(orgId);
    await signIn("viewer", orgId);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createPropertyAction(form({ name: "Boat", purchasePrice: "10" }));
    await updatePropertyValueAction(form({ propertyId: id, estimatedValue: "1" }));
    await deletePropertyAction(form({ propertyId: id }));

    expect(await property(orgId)).toEqual([expect.objectContaining({ name: "Cabin", estimated_value: 250000 })]);
  });
});
