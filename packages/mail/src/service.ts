import nodemailer, { createTestAccount } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { env } from "@acme/env";

import type { TemplateType } from "./templates";
import { DefaultSubject, renderTemplate, Templates } from "./templates";

const isLocalDevelopment = process.env.NODE_ENV !== "production";

/**
 * Default recipients for each template
 */
export const DefaultTo: { [key in Templates]?: string | string[] } = {
  [Templates.feedbackForm]: env.EMAIL_ADMIN_DESTINATIONS.split(","),
};

type TemplateMessage<T extends Templates> = TemplateType[T] & {
  to?: string | string[];
  subject?: string;
  from?: string;
};

type TemplateMessageParams<T extends Templates> =
  | TemplateMessage<T>[]
  | TemplateMessage<T>;

export class MailService {
  private transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null =
    null;
  templates = Templates;
  adminDestinations: string[] = env.EMAIL_ADMIN_DESTINATIONS.split(",");

  constructor() {
    //
  }

  /**
   * Render a template with the given parameters (type-safe)
   */
  public getTemplate<T extends Templates>(
    name: T,
    params: TemplateType[T],
  ): string {
    return renderTemplate(name, params);
  }

  /**
   * Preview a template (for testing/admin purposes)
   */
  public previewTemplate<T extends Templates>(
    name: T,
    params: TemplateType[T],
  ): string {
    return this.getTemplate(name, params);
  }

  async sendTemplateMessages<T extends Templates>(
    template: T,
    params: TemplateMessageParams<T>,
  ) {
    const paramsArray = Array.isArray(params) ? params : [params];
    if (!DefaultTo[template] && !paramsArray.every((p) => p.to)) {
      throw new Error("Missing to and no default to set");
    }

    if (!DefaultSubject[template] && !paramsArray.every((p) => p.subject)) {
      throw new Error("Missing subject and no default subject set");
    }

    const batchSize = 100;
    const sent: (Error | SMTPTransport.SentMessageInfo)[] = [];

    // Create batches
    for (let i = 0; i < paramsArray.length; i += batchSize) {
      const batchParams = paramsArray.slice(i, i + batchSize);
      const batchMessages = batchParams.map((item) => ({
        ...item,
        from: item.from ?? env.EMAIL_FROM,
        to: item.to ?? DefaultTo[template],
        subject: item.subject ?? DefaultSubject[template],
        html: this.getTemplate(template, item),
      }));
      const sentBatch = await this.sendViaTransporter(batchMessages);
      sent.push(...sentBatch);
    }

    return sent;
  }

  private async getTransporter() {
    if (!this.transporter) {
      const transporterOptions = isLocalDevelopment
        ? await createTestAccount().then(({ user, pass }) => ({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false,
            auth: { user, pass },
          }))
        : // Email now comes from F3 sendgrid
          env.EMAIL_SERVER;
      this.transporter = nodemailer.createTransport(transporterOptions);
    }
    return this.transporter;
  }

  private async sendViaTransporter(messages: Mail.Options[], batchSize = 50) {
    if (messages.some((m) => m.text)) {
      throw new Error("Text is not supported, just use html");
    }

    // Disable SendGrid click/open tracking - makes links look suspicious
    // See: https://github.com/F3-Nation/f3-nation/issues/45
    const sendGridHeaders = {
      "X-SMTPAPI": JSON.stringify({
        filters: {
          clicktrack: { settings: { enable: 0 } },
          opentrack: { settings: { enable: 0 } },
        },
      }),
    };

    const batches = messages.reduce((acc, message, i) => {
      const batchIndex = Math.floor(i / batchSize);
      acc[batchIndex] = acc[batchIndex] ?? [];
      acc[batchIndex]?.push(message);
      return acc;
    }, [] as Mail.Options[][]);

    const sentInfo: (SMTPTransport.SentMessageInfo | Error)[] = [];

    for (const batch of batches) {
      await Promise.all(
        batch.map((msg) =>
          this.getTransporter().then((t) =>
            t
              ?.sendMail({ ...msg, headers: sendGridHeaders })
              .then((info) => {
                sentInfo.push(info);
                console.log("\x1b[32m", "Message sent successfully!");
                if (isLocalDevelopment) {
                  console.log("\x1b[33m", nodemailer.getTestMessageUrl(info));
                }
              })
              .catch((error: Error) => {
                sentInfo.push(error);
                console.log("\x1b[31m", "Error occurred!");
                console.error("error", error.message);
              }),
          ),
        ),
      );
    }
    return sentInfo;
  }
}

export const mail = new MailService();
