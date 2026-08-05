// data comes from z.record(z.unknown()) — String() casts are intentional
/* eslint-disable @typescript-eslint/no-base-to-string */
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { env } from "@acme/env";
import { mail, Templates } from "@acme/mail";

import { logError } from "../logger";
import { nationAdminProcedure } from "../shared";

/**
 * Templates the sendTest/preview handlers actually implement. Narrowing the
 * input to this subset prevents unsupported templates (e.g. regionInABox) from
 * passing validation — which would make sendTest report success without sending
 * and preview throw "Unknown template".
 */
export const supportedTemplateSchema = z.enum([
  Templates.feedbackForm,
  Templates.mapChangeRequest,
]);

/**
 * Mail router for testing email templates (nation admin only)
 */
export const mailRouter = {
  /**
   * Get list of available email templates
   */
  templates: nationAdminProcedure
    .route({
      method: "GET",
      path: "/templates",
      tags: ["mail"],
      summary: "Get available email templates",
      description:
        "Returns a list of available email templates with their required and optional fields. Useful for testing and preview endpoints. Requires F3 Nation admin role.",
    })
    .handler(() => {
      return {
        templates: [
          {
            id: Templates.feedbackForm,
            name: "Feedback Form",
            description: "Email sent when a user submits feedback",
            fields: [
              { name: "type", type: "string", required: true },
              { name: "email", type: "string", required: true },
              { name: "subject", type: "string", required: true },
              { name: "description", type: "string", required: true },
            ],
          },
          {
            id: Templates.mapChangeRequest,
            name: "Map Change Request",
            description: "Email sent when a map change request is submitted",
            fields: [
              { name: "regionName", type: "string", required: true },
              { name: "workoutName", type: "string", required: true },
              { name: "requestType", type: "string", required: true },
              { name: "submittedBy", type: "string", required: true },
              { name: "requestsUrl", type: "string", required: true },
              { name: "noAdminsNotice", type: "boolean", required: false },
              { name: "recipientRole", type: "string", required: false },
              { name: "recipientOrg", type: "string", required: false },
            ],
          },
        ],
      };
    }),

  /**
   * Send a test email using a specific template
   */
  sendTest: nationAdminProcedure
    .input(
      z.object({
        template: supportedTemplateSchema.describe("The template ID to send"),
        to: z.email().describe("Recipient email address"),
        // Template-specific data
        data: z
          .record(z.string(), z.unknown())
          .describe(
            "Template-specific data object. See /mail/templates endpoint for required/optional fields.",
          ),
      }),
    )
    .route({
      method: "POST",
      path: "/send-test",
      tags: ["mail"],
      summary: "Send a test email",
      description:
        "Send a test email using a specific template (nation admin only). Useful for testing email configurations before sending to users.",
    })
    .handler(async ({ input }) => {
      const { template, to, data } = input;

      try {
        // Validate and send based on template type
        if (template === Templates.feedbackForm) {
          await mail.sendTemplateMessages(Templates.feedbackForm, {
            to,
            type: String(data.type ?? "Test Type"),
            email: String(data.email ?? "test@example.com"),
            subject: String(data.subject ?? "Test Subject"),
            description: String(data.description ?? "Test Description"),
          });
        } else if (template === Templates.mapChangeRequest) {
          const adminBaseUrl = env.NEXT_PUBLIC_ADMIN_URL?.endsWith("/")
            ? env.NEXT_PUBLIC_ADMIN_URL?.slice(0, -1)
            : (env.NEXT_PUBLIC_ADMIN_URL ?? "");

          await mail.sendTemplateMessages(Templates.mapChangeRequest, {
            to,
            regionName: String(data.regionName ?? "Test Region"),
            workoutName: String(data.workoutName ?? "Test Workout"),
            requestType: String(data.requestType ?? "Update"),
            submittedBy: String(data.submittedBy ?? "Test User"),
            requestsUrl: String(data.requestsUrl ?? `${adminBaseUrl}/requests`),
            noAdminsNotice: Boolean(data.noAdminsNotice),
            recipientRole: data.recipientRole
              ? String(data.recipientRole)
              : undefined,
            recipientOrg: data.recipientOrg
              ? String(data.recipientOrg)
              : undefined,
          });
        }

        return {
          success: true,
          message: `Test email sent to ${to}`,
        };
      } catch (error) {
        logError("api.mail.test_email_failed", { template, to }, error);
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "Failed to send email",
        };
      }
    }),

  /**
   * Preview an email template (returns rendered HTML)
   */
  preview: nationAdminProcedure
    .input(
      z.object({
        template: supportedTemplateSchema.describe(
          "The template ID to preview",
        ),
        data: z
          .record(z.string(), z.unknown())
          .describe(
            "Template-specific data object. See /mail/templates endpoint for required/optional fields.",
          ),
      }),
    )
    .route({
      method: "POST",
      path: "/preview",
      tags: ["mail"],
      summary: "Preview an email template",
      description:
        "Returns the rendered HTML for a template without sending it. Useful for verifying template output before use.",
    })
    .handler(({ input }) => {
      const { template, data } = input;

      let html: string;

      if (template === Templates.feedbackForm) {
        html = mail.getTemplate(Templates.feedbackForm, {
          type: String(data.type ?? "Test Type"),
          email: String(data.email ?? "test@example.com"),
          subject: String(data.subject ?? "Test Subject"),
          description: String(data.description ?? "Test Description"),
        });
      } else if (template === Templates.mapChangeRequest) {
        const adminBaseUrl = env.NEXT_PUBLIC_ADMIN_URL?.endsWith("/")
          ? env.NEXT_PUBLIC_ADMIN_URL?.slice(0, -1)
          : (env.NEXT_PUBLIC_ADMIN_URL ?? "");

        html = mail.getTemplate(Templates.mapChangeRequest, {
          regionName: String(data.regionName ?? "Test Region"),
          workoutName: String(data.workoutName ?? "Test Workout"),
          requestType: String(data.requestType ?? "Update"),
          submittedBy: String(data.submittedBy ?? "Test User"),
          requestsUrl: String(data.requestsUrl ?? `${adminBaseUrl}/requests`),
          noAdminsNotice: Boolean(data.noAdminsNotice),
          recipientRole: data.recipientRole
            ? String(data.recipientRole)
            : undefined,
          recipientOrg: data.recipientOrg
            ? String(data.recipientOrg)
            : undefined,
        });
      } else {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Unknown template",
        });
      }

      return { html };
    }),
};
