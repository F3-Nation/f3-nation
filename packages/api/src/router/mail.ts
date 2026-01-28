import { z } from "zod";

import { env } from "@acme/env";
import { mail, Templates } from "@acme/mail";
import { nationAdminProcedure } from "../shared";

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
      description: "Returns a list of available email templates for testing",
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
        template: z.nativeEnum(Templates),
        to: z.string().email(),
        // Template-specific data
        data: z.record(z.unknown()),
      }),
    )
    .route({
      method: "POST",
      path: "/send-test",
      tags: ["mail"],
      summary: "Send a test email",
      description:
        "Send a test email using a specific template (nation admin only)",
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
          const baseUrl = env.NEXT_PUBLIC_MAP_URL?.endsWith("/")
            ? env.NEXT_PUBLIC_MAP_URL.slice(0, -1)
            : env.NEXT_PUBLIC_MAP_URL ?? "";

          await mail.sendTemplateMessages(Templates.mapChangeRequest, {
            to,
            regionName: String(data.regionName ?? "Test Region"),
            workoutName: String(data.workoutName ?? "Test Workout"),
            requestType: String(data.requestType ?? "Update"),
            submittedBy: String(data.submittedBy ?? "Test User"),
            requestsUrl: String(
              data.requestsUrl ?? `${baseUrl}/admin/requests`,
            ),
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
        console.error("Failed to send test email", { error, template, to });
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
        template: z.nativeEnum(Templates),
        data: z.record(z.unknown()),
      }),
    )
    .route({
      method: "POST",
      path: "/preview",
      tags: ["mail"],
      summary: "Preview an email template",
      description: "Returns the rendered HTML for a template without sending",
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
        const baseUrl = env.NEXT_PUBLIC_MAP_URL?.endsWith("/")
          ? env.NEXT_PUBLIC_MAP_URL.slice(0, -1)
          : env.NEXT_PUBLIC_MAP_URL ?? "";

        html = mail.getTemplate(Templates.mapChangeRequest, {
          regionName: String(data.regionName ?? "Test Region"),
          workoutName: String(data.workoutName ?? "Test Workout"),
          requestType: String(data.requestType ?? "Update"),
          submittedBy: String(data.submittedBy ?? "Test User"),
          requestsUrl: String(data.requestsUrl ?? `${baseUrl}/admin/requests`),
          noAdminsNotice: Boolean(data.noAdminsNotice),
          recipientRole: data.recipientRole
            ? String(data.recipientRole)
            : undefined,
          recipientOrg: data.recipientOrg
            ? String(data.recipientOrg)
            : undefined,
        });
      } else {
        throw new Error("Unknown template");
      }

      return { html };
    }),
};
