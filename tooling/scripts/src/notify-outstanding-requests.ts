/**
 * Script to send reminder emails to admins about outstanding requests
 *
 * Usage:
 *   pnpm -F @acme/scripts notify-outstanding-requests --dry-run
 *   pnpm -F @acme/scripts notify-outstanding-requests --email=test@example.com --limit=1
 *   pnpm -F @acme/scripts notify-outstanding-requests
 *
 * Flags:
 *   --dry-run              Show what would be sent without sending
 *   --email=<address>      Send all emails to this address instead of real admins
 *   --limit=<n>            Only send n emails (useful for testing)
 */

import type { RequestType } from "@acme/shared/app/enums";

const DRY_RUN = process.argv.includes("--dry-run");
const CUTOFF_DATE = "2026-01-03"; // Requests created after this date

// Parse --email flag (e.g., --email=test@example.com)
const emailArgIndex = process.argv.findIndex((arg) =>
  arg.startsWith("--email="),
);
const OVERRIDE_EMAIL =
  emailArgIndex !== -1 ? process.argv[emailArgIndex]?.split("=")[1] : undefined;

// Parse --limit flag (e.g., --limit=1)
const limitArgIndex = process.argv.findIndex((arg) =>
  arg.startsWith("--limit="),
);
const EMAIL_LIMIT =
  limitArgIndex !== -1
    ? parseInt(process.argv[limitArgIndex]?.split("=")[1] ?? "0", 10)
    : undefined;

interface RequestWithRegion {
  id: string;
  regionId: number;
  regionName: string | null;
  eventName: string;
  submittedBy: string;
  requestType: RequestType;
  created: string;
}

interface AdminRecipient {
  email: string;
  roleName: string;
  orgName: string | null;
  requests: RequestWithRegion[];
}

async function main() {
  // Dynamic imports to avoid ESM resolution issues with tsx
  const { and, eq, gte } = await import("drizzle-orm");
  const { schema } = await import("@acme/db");
  const { db } = await import("@acme/db/client");
  const { env } = await import("@acme/env");
  const { requestTypeToTitle } = await import("@acme/shared/app/functions");
  const { mail, Templates } = await import("@acme/api/mail");
  const { getUsersWithRoles } = await import(
    "@acme/api/services/map-request-notification"
  );

  console.log("🔍 Finding outstanding requests created after", CUTOFF_DATE);
  console.log(
    DRY_RUN
      ? "📋 DRY RUN MODE - No emails will be sent"
      : "📧 LIVE MODE - Emails will be sent",
  );
  if (OVERRIDE_EMAIL) {
    console.log(`📬 All emails will be sent to: ${OVERRIDE_EMAIL}`);
  }
  if (EMAIL_LIMIT) {
    console.log(`🔢 Limiting to ${EMAIL_LIMIT} email(s)`);
  }
  console.log("");

  // Find all pending requests created after the cutoff date
  const pendingRequests = await db
    .select({
      id: schema.updateRequests.id,
      regionId: schema.updateRequests.regionId,
      regionName: schema.orgs.name,
      eventName: schema.updateRequests.eventName,
      submittedBy: schema.updateRequests.submittedBy,
      requestType: schema.updateRequests.requestType,
      created: schema.updateRequests.created,
    })
    .from(schema.updateRequests)
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.updateRequests.regionId))
    .where(
      and(
        eq(schema.updateRequests.status, "pending"),
        gte(schema.updateRequests.created, CUTOFF_DATE),
      ),
    )
    .orderBy(schema.updateRequests.created);

  if (pendingRequests.length === 0) {
    console.log("✅ No outstanding requests found!");
    return;
  }

  console.log(`Found ${pendingRequests.length} outstanding request(s)\n`);

  // Group requests by region
  const requestsByRegion = new Map<number, RequestWithRegion[]>();
  for (const request of pendingRequests) {
    const existing = requestsByRegion.get(request.regionId) ?? [];
    existing.push(request);
    requestsByRegion.set(request.regionId, existing);
  }

  console.log(`Requests span ${requestsByRegion.size} region(s)\n`);
  console.log("─".repeat(80));

  // Collect all admin recipients with their requests
  const adminEmailMap = new Map<string, AdminRecipient>();

  for (const [regionId, requests] of requestsByRegion) {
    const regionName = requests[0]?.regionName ?? "Unknown Region";
    console.log(`\n📍 Region: ${regionName} (ID: ${regionId})`);
    console.log(`   ${requests.length} pending request(s)`);

    // Find admins/editors for this region
    const recipients = await getUsersWithRoles({
      db,
      orgId: regionId,
      roleNames: ["admin", "editor"],
    });

    if (recipients.length === 0) {
      console.log(`   ⚠️  No admins/editors found for this region!`);
      continue;
    }

    for (const recipient of recipients) {
      const existing = adminEmailMap.get(recipient.email);
      if (existing) {
        // Add requests to existing recipient
        existing.requests.push(...requests);
      } else {
        adminEmailMap.set(recipient.email, {
          email: recipient.email,
          roleName: recipient.roleName,
          orgName: recipient.orgName,
          requests: [...requests],
        });
      }
    }

    console.log(
      `   👥 Admins/Editors: ${recipients.map((r) => r.email).join(", ")}`,
    );
  }

  console.log("\n" + "─".repeat(80));
  console.log("\n📬 Email Summary:\n");

  const baseUrl = env.NEXT_PUBLIC_API_URL?.endsWith("/")
    ? env.NEXT_PUBLIC_API_URL.slice(0, -1)
    : env.NEXT_PUBLIC_API_URL ?? "";
  const requestsUrl = `${baseUrl}/admin/requests`;

  // Display and optionally send emails
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const [email, recipient] of adminEmailMap) {
    const uniqueRegions = [
      ...new Set(recipient.requests.map((r) => r.regionName)),
    ];
    console.log(`📧 ${email} (${recipient.roleName} at ${recipient.orgName})`);
    console.log(`   Regions: ${uniqueRegions.join(", ")}`);
    console.log(`   Outstanding requests: ${recipient.requests.length}`);

    for (const request of recipient.requests) {
      const title = requestTypeToTitle(request.requestType);
      console.log(
        `     - [${title}] ${request.eventName} (submitted by ${request.submittedBy}, ${request.created})`,
      );
    }

    if (!DRY_RUN) {
      // Send one email per request to match the existing notification pattern
      const targetEmail = OVERRIDE_EMAIL ?? email;
      for (const request of recipient.requests) {
        // Check if we've hit the limit
        if (EMAIL_LIMIT && emailsSent >= EMAIL_LIMIT) {
          console.log(`   ⏹️  Reached email limit (${EMAIL_LIMIT}), stopping`);
          break;
        }
        try {
          await mail.sendTemplateMessages(Templates.mapChangeRequest, {
            to: targetEmail,
            subject: `[Reminder] Outstanding F3 Map Change Request`,
            regionName: request.regionName ?? "Unknown",
            workoutName: request.eventName ?? "Unknown",
            requestType: requestTypeToTitle(request.requestType),
            submittedBy: request.submittedBy,
            requestsUrl,
            recipientRole: recipient.roleName,
            recipientOrg: recipient.orgName ?? "Unknown",
          });
          emailsSent++;
        } catch (error) {
          emailsFailed++;
          console.error(
            `   ❌ Failed to send email for request ${request.id}:`,
            error,
          );
        }
      }
    }

    // Break out of outer loop if limit reached
    if (EMAIL_LIMIT && emailsSent >= EMAIL_LIMIT) {
      break;
    }
    console.log("");
  }

  console.log("─".repeat(80));
  console.log("\n📊 Summary:");
  console.log(`   Total outstanding requests: ${pendingRequests.length}`);
  console.log(`   Unique admins to notify: ${adminEmailMap.size}`);

  if (DRY_RUN) {
    console.log(
      `   Emails that would be sent: ${[...adminEmailMap.values()].reduce((sum, r) => sum + r.requests.length, 0)}`,
    );
    console.log("\n💡 Run without --dry-run to actually send emails");
  } else {
    console.log(`   Emails sent: ${emailsSent}`);
    if (emailsFailed > 0) {
      console.log(`   Emails failed: ${emailsFailed}`);
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
