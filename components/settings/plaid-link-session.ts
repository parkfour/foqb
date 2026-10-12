// Shared by the connect/reconnect buttons and the OAuth return page.
//
// Banks that sign in on their own site (OAuth — Chase, Bank of America, ...)
// can't always use Link's popup on phones; Plaid then redirects the whole
// tab to the bank and back to PLAID_REDIRECT_URI (/settings/bank-return),
// where Link must be re-opened with the SAME link token. So the token, and
// what it was for, is remembered here right before Link opens.

export interface PlaidLinkAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}

export interface PlaidLinkMetadata {
  institution: { name: string; institution_id: string } | null;
  accounts: PlaidLinkAccount[];
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
      }) => { open: () => void };
    };
  }
}

export type LinkSession = { token: string } & (
  | { mode: "connect" }
  | { mode: "reconnect"; enrollmentId: string }
);

const STORAGE_KEY = "foqb.plaidLinkSession";

export function rememberLinkSession(session: LinkSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: OAuth-by-redirect can't resume, popup flows still work.
  }
}

// Read once: a stale session must not re-open Link on a later visit.
export function takeLinkSession(): LinkSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LinkSession) : null;
  } catch {
    return null;
  }
}

// After Link update mode succeeds: mark the enrollment active server-side.
export async function finishReconnect(enrollmentId: string): Promise<boolean> {
  const response = await fetch("/api/bank/reconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enrollmentId }),
  });
  return response.ok;
}
