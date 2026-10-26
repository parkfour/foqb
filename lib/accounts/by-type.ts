export function byType<T extends { type: string }>(accounts: T[], type: string): T[] {
  return accounts.filter((a) => a.type === type);
}
