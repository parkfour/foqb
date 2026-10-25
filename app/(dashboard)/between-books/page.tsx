import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { BetweenBooksForm, type BookOption } from "@/components/between-books/between-books-form";

// The books this person can post in, each with its accounts and the bank
// transactions still waiting to be booked (one can stand for a side).
export default async function BetweenBooksPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) redirect("/");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: memberships }, role, showAccountCodes, today] = await Promise.all([
    supabase
      .from("organization_members")
      .select("role, organizations(id, name, currency, status)")
      .eq("user_id", user.id)
      .in("role", ["owner", "accountant"]),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
    bookToday(orgId),
  ]);

  const books = ((memberships ?? []) as unknown as { organizations: { id: string; name: string; currency: string; status: string } | null }[])
    .map((m) => m.organizations)
    .filter((o): o is NonNullable<typeof o> => !!o && o.status !== "suspended");

  const options: BookOption[] = await Promise.all(
    books.map(async (book) => {
      const [{ data: accounts }, { data: bank }] = await Promise.all([
        supabase
          .from("accounts")
          .select("id, account_number, name, type")
          .eq("organization_id", book.id)
          .eq("is_active", true)
          .order("account_number"),
        supabase
          .from("bank_transactions")
          .select("id, account_id, date, name, amount")
          .eq("organization_id", book.id)
          .eq("status", "unreconciled")
          .order("date", { ascending: false })
          .limit(100),
      ]);
      return {
        id: book.id,
        name: book.name,
        currency: book.currency,
        accounts: (accounts ?? []) as BookOption["accounts"],
        bankTransactions: (bank ?? []) as BookOption["bankTransactions"],
      };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Between Your Books"
        description="One event in two of your books, posted to both at once: an owner's draw, money put into a business, or a business expense paid personally."
      />
      {!canWrite(role) ? (
        <p className="text-sm text-slate-500">Only an owner or accountant of this book can post entries.</p>
      ) : options.length < 2 ? (
        <p className="text-sm text-slate-500">
          You need to be an owner or accountant in a second book, such as your household&rsquo;s or your business&rsquo;s.
        </p>
      ) : (
        <BetweenBooksForm thisBookId={orgId} books={options} today={today} showAccountCodes={showAccountCodes} />
      )}
    </div>
  );
}
