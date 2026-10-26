import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { AddClassForm } from "@/components/classes/add-class-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { toggleClass } from "./actions";

export default async function ClassesPage() {
  const orgId = await getCurrentOrgId();
  const description = "Tags for journal lines, invoices and bills, for a profit and loss by class.";
  if (!orgId) {
    return (
      <div>
        <PageHeader title="Classes" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase.from("classes").select("id, name, is_active").eq("organization_id", orgId).order("name"),
    getCurrentUserRole(orgId),
  ]);
  const classes = (data ?? []) as { id: string; name: string; is_active: boolean }[];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Classes" description={description} />
      <p className="text-sm text-slate-600">
        See them side by side in{" "}
        <Link href="/reports?report=income-statement-by-class" className="underline hover:text-slate-900">
          Profit &amp; Loss by Class
        </Link>
        . A class that&apos;s turned off stays on what it&apos;s already on.
      </p>
      {userCanWrite && <AddClassForm />}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <tbody>
            {classes.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-center text-slate-500">No classes yet.</td>
              </tr>
            ) : (
              classes.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className={`px-5 py-3 ${c.is_active ? "text-slate-900" : "text-slate-400"}`}>{c.name}</td>
                  <td className="px-5 py-3 text-right">
                    {userCanWrite && (
                      <form action={toggleClass}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="isActive" value={String(c.is_active)} />
                        <button type="submit" className="text-sm text-slate-400 hover:text-slate-900">
                          {c.is_active ? "Turn off" : "Turn on"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
