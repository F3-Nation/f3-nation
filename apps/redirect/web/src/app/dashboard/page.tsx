import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domain } from "@/db/schema";
import { Dashboard } from "@/components/Dashboard";
import { dnsInstructions } from "@/lib/domains";

export default async function DashboardPage() {
  const sess = await auth.api.getSession({ headers: await headers() });
  if (!sess?.user) redirect("/");

  const rows = await db
    .select()
    .from(domain)
    .where(eq(domain.userId, sess.user.id))
    .orderBy(domain.hostname);

  const initial = rows.map((r) => ({
    id: r.id,
    hostname: r.hostname,
    destination: r.destinationUrl,
    dns: dnsInstructions(r.hostname),
  }));

  return <Dashboard initial={initial} userEmail={sess.user.email} />;
}
