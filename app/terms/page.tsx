import Link from "next/link";
import { getOperatorInfo } from "@/lib/legal/operator";

const LAST_UPDATED = "September 21, 2026";

export default function TermsOfServicePage() {
  const operator = getOperatorInfo();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-700">
      <Link href="/" className="text-slate-500 hover:text-slate-900">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">Terms of Service</h1>
      <p className="mt-1 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>

      {!operator ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
          This instance of FOQB has not configured its operator details
          (<code>LEGAL_OPERATOR_NAME</code>, <code>LEGAL_CONTACT_EMAIL</code>,{" "}
          <code>LEGAL_JURISDICTION</code>). No terms of service are in effect until it does.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <section>
            <h2 className="text-base font-semibold text-slate-900">1. Agreement to terms</h2>
            <p className="mt-2">
              These Terms of Service (&ldquo;Terms&rdquo;) are a legal agreement between you and{" "}
              {operator.name} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) governing
              your use of this instance of FOQB (the &ldquo;Service&rdquo;). By creating an account
              or using the Service, you agree to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">2. The Service</h2>
            <p className="mt-2">
              FOQB is a bookkeeping tool: double-entry accounting, bank transaction syncing,
              invoicing, and financial reporting. It is a tool to help you keep records — it is not
              a substitute for professional accounting, tax, or legal advice, and we make no
              representation that using it satisfies any legal, tax, or regulatory obligation you
              may have.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">3. Accounts</h2>
            <p className="mt-2">
              You&rsquo;re responsible for the accuracy of the information you provide and for
              keeping your login credentials secure. If you create an organization, you&rsquo;re
              its Owner and are responsible for the accounts you create for other members and for
              how you distribute their credentials. You&rsquo;re responsible for your
              organization&rsquo;s data and for backing it up (Settings → Download full backup).
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">4. Acceptable use</h2>
            <p className="mt-2">
              You agree not to use the Service for any unlawful purpose, to attempt to gain
              unauthorized access to any part of the Service or another organization&rsquo;s data,
              or to interfere with the Service&rsquo;s normal operation.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">5. Bank connections</h2>
            <p className="mt-2">
              If you connect a bank account, that connection is provided through Plaid, Inc., and
              your use of that connection is also subject to Plaid&rsquo;s own terms. You
              authorize us to retrieve and store the account and transaction data Plaid provides on
              your behalf for as long as the connection remains active.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              6. Suspension and termination
            </h2>
            <p className="mt-2">
              We may suspend or delete an organization&rsquo;s access to the Service for violation
              of these Terms, for abuse, or as otherwise reasonably necessary to operate the
              Service. Where practical, a suspended organization&rsquo;s Owner retains enough
              access to download a full backup of their data. You may also delete your own
              organization at any time.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">7. Your data</h2>
            <p className="mt-2">
              You own the data you put into the Service. You can export it at any time. If your
              organization is deleted — by you or by us for cause — that data is permanently
              removed and we cannot recover it, so keep your own backups.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              8. Disclaimer of warranties
            </h2>
            <p className="mt-2">
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
              warranties of any kind, express or implied, including fitness for a particular
              purpose or non-infringement.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              9. Limitation of liability
            </h2>
            <p className="mt-2">
              To the fullest extent permitted by law, {operator.name} will not be liable for any
              indirect, incidental, special, or consequential damages arising from your use of the
              Service, including loss of data or loss of business, even if advised of the
              possibility of such damages.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">10. Governing law</h2>
            <p className="mt-2">
              These Terms are governed by the laws of {operator.jurisdiction}, without regard to
              its conflict-of-law principles.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">11. Changes to these terms</h2>
            <p className="mt-2">
              We may update these Terms from time to time. We&rsquo;ll update the &ldquo;Last
              updated&rdquo; date above when we do. Continued use of the Service after a change
              means you accept the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">12. Contact us</h2>
            <p className="mt-2">
              Questions about these Terms? Email{" "}
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
