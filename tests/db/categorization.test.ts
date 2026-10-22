import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { createAccount, createOrg } from "./helpers";

interface RuleOverrides {
  matchType: string;
  matchText: string;
  transactionType: string;
  minAmount: number | null;
  maxAmount: number | null;
  priority: number;
  isActive: boolean;
  ruleName: string;
  bankAccountId: string | null;
}

async function addRule(
  client: Client,
  orgId: string,
  accountId: string,
  overrides: Partial<RuleOverrides> = {},
): Promise<void> {
  await client.query(
    `insert into categorization_rules
      (organization_id, target_account_id, rule_name, match_type, match_text, transaction_type, min_amount, max_amount, priority, is_active, bank_account_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      orgId,
      accountId,
      overrides.ruleName ?? "Rule",
      overrides.matchType ?? "contains",
      overrides.matchText ?? "STARBUCKS",
      overrides.transactionType ?? "any",
      overrides.minAmount ?? null,
      overrides.maxAmount ?? null,
      overrides.priority ?? 10,
      overrides.isActive ?? true,
      overrides.bankAccountId ?? null,
    ],
  );
}

describe("match_bank_transaction", () => {
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

  async function match(
    orgId: string,
    description: string,
    amount: number,
    bankAccountId: string | null = null,
  ): Promise<string | null> {
    const { rows } = await client.query("select match_bank_transaction($1, $2, $3, $4) as account_id", [
      orgId,
      description,
      amount,
      bankAccountId,
    ]);
    return rows[0].account_id;
  }

  it("applies a rule limited to a bank account only to that account's transactions", async () => {
    const orgId = await createOrg(client);
    const roth = await createAccount(client, orgId, { name: "Roth" });
    const taxable = await createAccount(client, orgId, { name: "Taxable" });
    const rothGains = await createAccount(client, orgId, { name: "Roth gains" });
    const taxableGains = await createAccount(client, orgId, { name: "Taxable gains" });
    await addRule(client, orgId, rothGains, { matchText: "Change in Investment Value", bankAccountId: roth });
    await addRule(client, orgId, taxableGains, { matchText: "Change in Investment Value", bankAccountId: taxable });

    expect(await match(orgId, "Change in Investment Value", 10, roth)).toBe(rothGains);
    expect(await match(orgId, "Change in Investment Value", 10, taxable)).toBe(taxableGains);
    expect(await match(orgId, "Change in Investment Value", 10)).toBeNull();
  });

  it("tries a rule for the account before one for any account at the same priority", async () => {
    const orgId = await createOrg(client);
    const checking = await createAccount(client, orgId);
    const general = await createAccount(client, orgId);
    const specific = await createAccount(client, orgId);
    await addRule(client, orgId, general, { matchText: "ZELLE" });
    await addRule(client, orgId, specific, { matchText: "ZELLE", bankAccountId: checking });

    expect(await match(orgId, "ZELLE FROM PAT", 50, checking)).toBe(specific);
    expect(await match(orgId, "ZELLE FROM PAT", 50, general)).toBe(general);
  });

  it("refuses a rule limited to another organization's account", async () => {
    const orgId = await createOrg(client);
    const otherOrg = await createOrg(client);
    const target = await createAccount(client, orgId);
    const foreign = await createAccount(client, otherOrg);
    await client.query("savepoint s");
    await expect(addRule(client, orgId, target, { bankAccountId: foreign })).rejects.toThrow(/same organization/);
    await client.query("rollback to savepoint s");
  });

  it("matches 'contains' rules case-insensitively", async () => {
    const orgId = await createOrg(client);
    const account = await createAccount(client, orgId, { name: "Coffee" });
    await addRule(client, orgId, account, { matchType: "contains", matchText: "starbucks" });

    expect(await match(orgId, "STARBUCKS STORE #123", -5.5)).toBe(account);
    expect(await match(orgId, "no match here", -5.5)).toBeNull();
  });

  it("matches 'starts_with' and 'exact' rules", async () => {
    const orgId = await createOrg(client);
    const startsAccount = await createAccount(client, orgId);
    const exactAccount = await createAccount(client, orgId);
    await addRule(client, orgId, startsAccount, { matchType: "starts_with", matchText: "AMZN", priority: 5 });
    await addRule(client, orgId, exactAccount, { matchType: "exact", matchText: "RENT", priority: 5 });

    expect(await match(orgId, "AMZN Marketplace", -20)).toBe(startsAccount);
    expect(await match(orgId, "RENT", -1000)).toBe(exactAccount);
    expect(await match(orgId, "MY RENT PAYMENT", -1000)).toBeNull();
  });

  it("matches 'regex' rules", async () => {
    const orgId = await createOrg(client);
    const account = await createAccount(client, orgId);
    await addRule(client, orgId, account, { matchType: "regex", matchText: "^UBER( EATS)?$" });

    expect(await match(orgId, "UBER", -12)).toBe(account);
    expect(await match(orgId, "UBER EATS", -12)).toBe(account);
    expect(await match(orgId, "UBER RIDES INC", -12)).toBeNull();
  });

  it("filters by transaction_type", async () => {
    const orgId = await createOrg(client);
    const account = await createAccount(client, orgId);
    await addRule(client, orgId, account, {
      matchType: "contains",
      matchText: "PAYROLL",
      transactionType: "credit",
    });

    expect(await match(orgId, "PAYROLL DEPOSIT", 1500)).toBe(account);
    expect(await match(orgId, "PAYROLL DEPOSIT", -1500)).toBeNull();
  });

  it("filters by min_amount and max_amount against the absolute amount", async () => {
    const orgId = await createOrg(client);
    const account = await createAccount(client, orgId);
    await addRule(client, orgId, account, {
      matchType: "contains",
      matchText: "AWS",
      minAmount: 50,
      maxAmount: 500,
    });

    expect(await match(orgId, "AWS BILL", -100)).toBe(account);
    expect(await match(orgId, "AWS BILL", -10)).toBeNull();
    expect(await match(orgId, "AWS BILL", -600)).toBeNull();
  });

  it("returns the first match ordered by priority ascending", async () => {
    const orgId = await createOrg(client);
    const lowPriorityAccount = await createAccount(client, orgId);
    const highPriorityAccount = await createAccount(client, orgId);
    await addRule(client, orgId, lowPriorityAccount, {
      matchType: "contains",
      matchText: "STORE",
      priority: 20,
    });
    await addRule(client, orgId, highPriorityAccount, {
      matchType: "contains",
      matchText: "STORE",
      priority: 1,
    });

    expect(await match(orgId, "GENERAL STORE", -10)).toBe(highPriorityAccount);
  });

  it("ignores inactive rules", async () => {
    const orgId = await createOrg(client);
    const account = await createAccount(client, orgId);
    await addRule(client, orgId, account, {
      matchType: "contains",
      matchText: "NETFLIX",
      isActive: false,
    });

    expect(await match(orgId, "NETFLIX.COM", -15)).toBeNull();
  });

  it("does not match rules belonging to a different organization", async () => {
    const orgA = await createOrg(client);
    const orgB = await createOrg(client);
    const accountB = await createAccount(client, orgB);
    await addRule(client, orgB, accountB, { matchType: "contains", matchText: "SHARED" });

    expect(await match(orgA, "SHARED MERCHANT", -10)).toBeNull();
  });

  it("returns null when no rule matches", async () => {
    const orgId = await createOrg(client);
    expect(await match(orgId, "UNKNOWN MERCHANT", -42)).toBeNull();
  });

  it("refuses an invalid regular expression, so one rule can't break matching", async () => {
    const orgId = await createOrg(client);
    const accountId = await createAccount(client, orgId);

    await client.query("SAVEPOINT s");
    await expect(addRule(client, orgId, accountId, { matchType: "regex", matchText: "[a-z" })).rejects.toThrow(
      /isn't a valid regular expression/,
    );
    await client.query("ROLLBACK TO SAVEPOINT s");

    // A valid pattern is fine, and matching keeps working.
    await addRule(client, orgId, accountId, { matchType: "regex", matchText: "^AMZN\\*" });
    expect(await match(orgId, "AMZN*MKTP US", -10)).toBe(accountId);
  });

  it("refuses switching an invalid regex rule back on", async () => {
    const orgId = await createOrg(client);
    const accountId = await createAccount(client, orgId);
    await addRule(client, orgId, accountId, { matchType: "regex", matchText: "[a-z", isActive: false });

    await expect(
      client.query("update categorization_rules set is_active = true where organization_id = $1", [orgId]),
    ).rejects.toThrow(/isn't a valid regular expression/);
  });
});
