import { randomUUID } from "node:crypto";
import type { Client } from "pg";

export function newId(): string {
  return randomUUID();
}

// Switches the current (already-open) transaction to the `authenticated`
// role with auth.uid() resolving to `userId`, so RLS policies apply exactly
// as they would for that user. `SET LOCAL` auto-reverts on COMMIT/ROLLBACK.
export async function asUser(client: Client, userId: string): Promise<void> {
  // Read the email before switching role — real Supabase doesn't grant the
  // `authenticated` role SELECT on auth.users either, so this has to run as
  // the original (superuser) role.
  const { rows } = await client.query("select email from auth.users where id = $1", [userId]);
  const email = ((rows[0]?.email as string | undefined) ?? "").replace(/'/g, "''");

  await client.query("SET LOCAL ROLE authenticated");
  await client.query(`SET LOCAL request.jwt.claim.sub = '${userId}'`);
  await client.query(`SET LOCAL request.jwt.claim.email = '${email}'`);
}

export async function createUser(client: Client, email = "test@example.com"): Promise<string> {
  const id = newId();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

export async function createOrg(client: Client, name = "Test Org"): Promise<string> {
  const id = newId();
  await client.query("insert into organizations (id, name) values ($1, $2)", [id, name]);
  return id;
}

export async function addMember(
  client: Client,
  orgId: string,
  userId: string,
  role: "owner" | "accountant" | "viewer" = "owner",
): Promise<void> {
  await client.query(
    "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
    [orgId, userId, role],
  );
}

export async function createAccount(
  client: Client,
  orgId: string,
  overrides: Partial<{ accountNumber: string; name: string; type: string }> = {},
): Promise<string> {
  const id = newId();
  await client.query(
    "insert into accounts (id, organization_id, account_number, name, type) values ($1, $2, $3, $4, $5)",
    [
      id,
      orgId,
      overrides.accountNumber ?? `AC-${id.slice(0, 8)}`,
      overrides.name ?? "Test Account",
      overrides.type ?? "asset",
    ],
  );
  return id;
}

export async function createCustomer(
  client: Client,
  orgId: string,
  overrides: Partial<{ name: string }> = {},
): Promise<string> {
  const id = newId();
  await client.query("insert into customers (id, organization_id, name) values ($1, $2, $3)", [
    id,
    orgId,
    overrides.name ?? "Test Customer",
  ]);
  return id;
}

export async function createVendor(
  client: Client,
  orgId: string,
  overrides: Partial<{ name: string }> = {},
): Promise<string> {
  const id = newId();
  await client.query("insert into vendors (id, organization_id, name) values ($1, $2, $3)", [
    id,
    orgId,
    overrides.name ?? "Test Vendor",
  ]);
  return id;
}

export async function createInventoryItem(
  client: Client,
  orgId: string,
  overrides: Partial<{ sku: string; name: string; quantityOnHand: number; unitCost: number }> = {},
): Promise<string> {
  const id = newId();
  await client.query(
    "insert into inventory_items (id, organization_id, sku, name, quantity_on_hand, unit_cost) values ($1, $2, $3, $4, $5, $6)",
    [
      id,
      orgId,
      overrides.sku ?? `SKU-${id.slice(0, 8)}`,
      overrides.name ?? "Test Item",
      overrides.quantityOnHand ?? 10,
      overrides.unitCost ?? 5,
    ],
  );
  return id;
}
