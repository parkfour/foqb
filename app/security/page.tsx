import Link from "next/link";
import { getOperatorInfo } from "@/lib/legal/operator";

const LAST_UPDATED = "October 12, 2026";

export default function SecurityPolicyPage() {
  const operator = getOperatorInfo();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-700">
      <Link href="/" className="text-slate-500 hover:text-slate-900">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">Security</h1>
      <p className="mt-1 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>

      {!operator ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
          This instance of FOQB has not configured its operator details
          (<code>LEGAL_OPERATOR_NAME</code>, <code>LEGAL_CONTACT_EMAIL</code>,{" "}
          <code>LEGAL_JURISDICTION</code>). No security program statement is published until it
          does.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <section>
            <p>
              This page describes how {operator.name} secures this instance of FOQB and the data
              it holds, including bank data accessed through Plaid. It is a description of actual
              current practice, not a certification or a claim of formal accreditation.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Governance</h2>
            <p className="mt-2">
              {operator.name} is responsible for the security of this instance. This document is
              our information security policy: it is reviewed and updated whenever practices
              described here change, and the &ldquo;Last updated&rdquo; date above reflects the
              most recent revision. Written operating procedures implement it (access management,
              change management, key rotation, incident response, vulnerability management, and
              backup and recovery) and are available on request.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Encryption</h2>
            <p className="mt-2">
              All traffic to the Service is encrypted in transit (TLS). Bank access tokens
              returned by Plaid are encrypted at rest before storage and are never logged or
              exposed in plaintext outside the request that decrypts them for an active API call.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Access control</h2>
            <p className="mt-2">
              Each organization&rsquo;s data is isolated from every other organization&rsquo;s at
              the database level (Postgres Row Level Security), enforced independently of
              application code — a bug in application logic cannot by itself expose one
              organization&rsquo;s data to another. Account roles (owner, accountant, viewer)
              gate what a member can read or change within their own organization. Two-factor
              authentication (TOTP) is available to every account from Settings, and is required
              to connect or reconnect a bank account. Once enabled, the database itself refuses
              a session that hasn&rsquo;t completed the second factor. Connecting banks can
              be turned off for this whole instance, or by an organization&rsquo;s owners for
              their organization.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              Change management and testing
            </h2>
            <p className="mt-2">
              Every code change runs through an automated pipeline — type checking, linting, and
              unit, component, and database integration tests — before it can reach production.
              No change is deployed without passing that gate.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Audit logging</h2>
            <p className="mt-2">
              Changes to accounting records and organization membership are recorded in an audit
              log visible to members of the affected organization. Administrative actions taken
              by {operator.name} on an organization&rsquo;s behalf are separately logged.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Sub-processors</h2>
            <p className="mt-2">
              This instance runs on Vercel (application hosting) and Supabase (database and
              authentication). Bank connections are provided by Plaid, Inc. All three are
              established providers with their own independent security and compliance programs.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Data minimization</h2>
            <p className="mt-2">
              We collect only what the Service needs to function. Deleting an organization
              permanently removes its records, retaining only the organization&rsquo;s name and
              deletion date. See our{" "}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>{" "}
              for the full data lifecycle.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Incident response</h2>
            <p className="mt-2">
              If you believe you&rsquo;ve found a security issue affecting this Service, email{" "}
              <a href={`mailto:${operator.contactEmail}`} className="underline">
                {operator.contactEmail}
              </a>{" "}
              with details. We investigate reports promptly and will notify affected
              organizations directly if an incident is confirmed to have exposed their data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">Independent testing</h2>
            <p className="mt-2">
              We perform our own internal security review of the codebase on an ongoing basis. An
              independent third-party security assessment has not yet been completed; it is
              planned as the Service and its user base grow.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
