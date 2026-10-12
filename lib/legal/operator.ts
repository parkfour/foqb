// Legal pages (Privacy Policy, Terms of Service) name whoever operates this
// specific instance, not FOQB the project — each self-hosted deployment
// configures its own values here rather than inheriting Park Four's.
// Unconfigured on a fresh clone by design: showing a clear placeholder is
// safer than silently displaying someone else's legal identity.
export interface OperatorInfo {
  name: string;
  contactEmail: string;
  jurisdiction: string;
}

export function getOperatorInfo(): OperatorInfo | null {
  const name = process.env.LEGAL_OPERATOR_NAME;
  const contactEmail = process.env.LEGAL_CONTACT_EMAIL;
  const jurisdiction = process.env.LEGAL_JURISDICTION;

  if (!name || !contactEmail || !jurisdiction) {
    return null;
  }

  return { name, contactEmail, jurisdiction };
}
