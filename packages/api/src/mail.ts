import { promises as fs } from "fs";
import path from "path";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { z } from "zod";
import handlebars from "handlebars";
import nodemailer, { createTestAccount } from "nodemailer";

import { env } from "@acme/env";

import type { feedbackSchema } from "./router/feedback";

const isLocalDevelopment = process.env.NODE_ENV !== "production";
export enum Templates {
  feedbackForm = "feedback-form",
  mapChangeRequest = "map-change-request",
}

export const DefaultSubject: { [key in Templates]?: string } = {
  [Templates.feedbackForm]: "Feedback Form",
  [Templates.mapChangeRequest]: "F3 Map Change Request",
};

export const DefaultTo: { [key in Templates]?: string | string[] } = {
  [Templates.feedbackForm]: env.EMAIL_ADMIN_DESTINATIONS.split(","),
};

export enum UnsubGroup {}

export interface TemplateType {
  [Templates.feedbackForm]: z.infer<typeof feedbackSchema>;
  [Templates.mapChangeRequest]: {
    regionName: string;
    workoutName: string;
    requestType: string;
    submittedBy: string;
    requestsUrl: string;
    noAdminsNotice?: boolean;
    recipientRole?: string;
    recipientOrg?: string;
  };
}

type TemplateMessage<T extends Templates> = TemplateType[T] & {
  to?: string | string[];
  subject?: string;
  from?: string;
};

type TemplateMessageParams<T extends Templates> =
  | TemplateMessage<T>[]
  | TemplateMessage<T>;

export class MailService {
  // For handling some single emails
  private transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null =
    null;
  templates = Templates;
  adminDestinations: string[] = env.EMAIL_ADMIN_DESTINATIONS.split(",");
  fileContentDict: Record<string, string> = {};

  constructor() {
    //
  }

  /**
   * Prepare a template to store in the class so that it doesn't get opened over and over again when sending mail
   */
  public async prepTemplate<T extends Templates>(name: T) {
    // This only works when we run it from apps/nextjs. If script runs then it fails
    // In that case it needs to be ../../apps/nextjs/src/templates
    const templateDirectory = path.join(process.cwd(), "src/templates");
    let fileContent = this.fileContentDict[name];
    if (fileContent) {
      console.log("fileContent already exists");
    } else {
      console.log("fileContent doesn't exist. Creating");
      fileContent = await fs.readFile(templateDirectory + `/${name}.hbs`, {
        encoding: "utf8",
      });
      this.fileContentDict[name] = fileContent;
    }
  }

  public async getTemplate<T extends Templates>(
    name: T,
    params: TemplateType[T],
  ): Promise<string> {
    const templateDirectory = path.join(process.cwd(), "src/templates");

    let fileContent = this.fileContentDict[name];
    if (fileContent) {
      console.log("fileContent already exists");
    } else {
      console.log("fileContent doesn't exist. Creating");
      fileContent = await fs.readFile(templateDirectory + `/${name}.hbs`, {
        encoding: "utf8",
      });
      this.fileContentDict[name] = fileContent;
    }
    const template = handlebars.compile(fileContent);
    const templateResult = template(params);
    return templateResult;
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
      throw new Error("Missing to and no default to set");
    }

    // When sending template emails, we can't have too many files open at the same time
    // So we batch them in groups of 100 (the template file)
    // https://github.com/vercel/next.js/issues/52646 related
    await this.prepTemplate(template); // Prep template to ensure it is only opened once
    const batchSize = 100;
    const sent: (Error | SMTPTransport.SentMessageInfo)[] = [];

    // Create batches
    for (let i = 0; i < paramsArray.length; i += batchSize) {
      const batchParams = paramsArray.slice(i, i + batchSize);
      const batchMessages = await Promise.all(
        batchParams.map(async (item) => ({
          ...item,
          from: item.from ? item.from : env.EMAIL_FROM,
          to: item.to ? item.to : DefaultTo[template],
          subject: item.subject ? item.subject : DefaultSubject[template],
          html: await this.getTemplate(template, item),
        })),
      );
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
              ?.sendMail(msg)
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
