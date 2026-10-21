import Link from "next/link";
import { getOperatorInfo } from "@/lib/legal/operator";

const LAST_UPDATED = "October 11, 2026";

export default function PrivacyPolicyPage() {
  const operator = getOperatorInfo();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-700">
      <Link href="/" className="text-slate-500 hover:text-slate-900">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>

      {!operator ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
          This instance of FOQB has not configured its operator details
          (<code>LEGAL_OPERATOR_NAME</code>, <code>LEGAL_CONTACT_EMAIL</code>,{" "}
          <code>LEGAL_JURISDICTION</code>). No privacy policy is in effect until it does.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <section>
            <h2 className="text-base font-semibold text-slate-900">1. Who we are</h2>
            <p className="mt-2">
              This Privacy Policy describes how {operator.name} (&ldquo;we,&rdquo; &ldquo;us,&rdquo;
              or &ldquo;our&rdquo;) collects, uses, and protects information when you use this
              instance of FOQB (the &ldquo;Service&rdquo;). If you have questions about this
              policy, contact us at{" "}
              <a href={`mailto:${operator.contactEmail}`} className="underline">
                {operator.contactEmail}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">2. What we collect</h2>
            <ul className="mt-2 list-disc pl-5">
              <li>
                <strong>Account information:</strong> your email address and password (handled by
                our authentication provider; we never see or store your password in plain text).
              </li>
              <li>
                <strong>Financial data you provide:</strong> the accounts, transactions, invoices,
                bills, customers, vendors, and other bookkeeping records you enter directly.
              </li>
              <li>
                <strong>Bank data, if you choose to connect a bank account:</strong> account
                balances and transaction history, retrieved via Plaid on your explicit
                authorization. We never receive or store your bank login credentials — Plaid
                handles that connection directly and gives us only an access token and the data
                you&rsquo;ve authorized us to see.
              </li>
              <li>
                <strong>Activity records:</strong> an audit log of changes made to accounting
                records and organization membership, so you and other members of your organization
                can see who did what and when.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">3. How we use it</h2>
            <p className="mt-2">
              We use your information solely to provide and maintain the Service: to record and
              display your bookkeeping data, to sync bank transactions you&rsquo;ve authorized, and
              to operate account and organization management. We do not sell your data, and we do
              not use it for advertising or share it with third parties for their own marketing
              purposes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">4. Third parties we work with</h2>
            <ul className="mt-2 list-disc pl-5">
              <li>
                <strong>Plaid, Inc.</strong> — if you connect a bank account, Plaid facilitates
                that connection and shares transaction data with us on your behalf, subject to{" "}
                <a
                  href="https://plaid.com/legal/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Plaid&rsquo;s own privacy policy
                </a>
                .
              </li>
              <li>
                <strong>Supabase</strong> — provides the database and authentication
                infrastructure the Service runs on.
              </li>
              <li>
                <strong>Vercel</strong> — hosts the application itself.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. How long we keep your data
            </h2>
            <p className="mt-2">
              Your data stays in your organization for as long as you or your organization&rsquo;s
              members keep using the Service. You can download a full export of your
              organization&rsquo;s data at any time from Settings. If an organization is deleted
              (by its own decision, or by a site administrator for cause), its records are
              permanently removed, except for a minimal record of the deletion itself — the
              organization&rsquo;s name and the date it was deleted — kept so former members can be
              told what happened to their organization. Its bank connections are also removed at
              Plaid.
            </p>
            <p className="mt-2">
              Bank transactions you&rsquo;ve imported are part of your books, so they stay after you
              disconnect a bank; disconnecting stops any further access to that bank immediately.
              Deleted data can remain in our encrypted backups until they rotate out, which takes
              at most 8 weeks. Rate-limiting records, which include IP addresses, are deleted automatically within
              24 hours.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">6. Security</h2>
            <p className="mt-2">
              Bank access tokens are encrypted at rest. All traffic to the Service is encrypted in
              transit. Each organization&rsquo;s data is isolated from every other organization&rsquo;s
              at the database level, enforced independently of the application code. We can&rsquo;t
              guarantee perfect security, but we take reasonable, industry-standard measures to
              protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">7. Your rights</h2>
            <p className="mt-2">
              You can access and export your organization&rsquo;s data at any time. You can ask us,
              at {operator.contactEmail}, to delete your account or your organization&rsquo;s data,
              subject to any records we&rsquo;re required to retain by law. We complete deletion
              requests within 30 days. When you agree to our Terms of Service and this Privacy
              Policy, we record which version you agreed to and when, and ask you to agree again
              whenever either one changes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">8. Children&rsquo;s privacy</h2>
            <p className="mt-2">
              The Service is not directed to, and we do not knowingly collect information from,
              anyone under 16 years old.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">9. Changes to this policy</h2>
            <p className="mt-2">
              We may update this policy from time to time. We&rsquo;ll update the &ldquo;Last
              updated&rdquo; date above when we do.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">10. Contact us</h2>
            <p className="mt-2">
              Questions about this policy? Email{" "}
              <a href={`mailto:${operator.contactEmail}`} className="underline">
                {operator.contactEmail}
              </a>
              .
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
