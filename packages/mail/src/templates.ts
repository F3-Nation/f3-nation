/**
 * Email template identifiers
 */
export enum Templates {
  feedbackForm = "feedback-form",
  mapChangeRequest = "map-change-request",
  regionInABox = "region-in-a-box",
}

/**
 * Default subjects for each template
 */
export const DefaultSubject: Partial<Record<Templates, string>> = {
  [Templates.feedbackForm]: "Feedback Form",
  [Templates.mapChangeRequest]: "F3 Map Change Request",
  [Templates.regionInABox]:
    "You're on the map! We want to send you resources to accelerate your growth",
};

/**
 * Feedback form template data
 */
export interface FeedbackFormData {
  type: string;
  email: string;
  subject: string;
  description: string;
}

/**
 * Map change request template data
 */
export interface MapChangeRequestData {
  regionName: string;
  workoutName: string;
  requestType: string;
  submittedBy: string;
  requestsUrl: string;
  noAdminsNotice?: boolean;
  recipientRole?: string;
  recipientOrg?: string;
}

/**
 * Region-in-a-box welcome email template data
 */
export interface RegionInABoxData {
  regionName: string;
}

/**
 * Template data types mapped by template
 */
export interface TemplateType {
  [Templates.feedbackForm]: FeedbackFormData;
  [Templates.mapChangeRequest]: MapChangeRequestData;
  [Templates.regionInABox]: RegionInABoxData;
}

// Shared email styles
const emailStyles = `
  body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
  .container { max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
  .header { font-size: 24px; margin-bottom: 20px; color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
  .content { font-size: 16px; line-height: 1.6; margin-bottom: 20px; color: #333; }
  .highlight { font-weight: bold; color: #007bff; }
  .action-button { display: inline-block; background-color: #007bff; color: white !important; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; }
  .notice { background-color: #fffbea; border-left: 4px solid #ffd700; padding: 10px; margin-top: 15px; }
  .footer { margin-top: 30px; font-size: 14px; color: #777; text-align: center; border-top: 1px solid #eee; padding-top: 15px; }
  .role-info { background-color: #f0f7ff; border-left: 4px solid #007bff; padding: 10px; margin-top: 15px; font-size: 15px; }
  .field-label { font-weight: bold; color: #333; }
  .field-value { margin-top: 5px; margin-bottom: 15px; padding: 8px; background-color: #f9f9f9; border-left: 3px solid #007bff; color: #222; }
`;

/**
 * Type-safe template render functions
 * Using TypeScript template literals ensures compile-time type checking
 */
export const templateRenderers: {
  [K in Templates]: (data: TemplateType[K]) => string;
} = {
  [Templates.feedbackForm]: (data: FeedbackFormData) => `<html>
  <head><style>${emailStyles}</style></head>
  <body>
    <div class="container">
      <div class="header">F3 Feedback Form Submission</div>
      <div class="content">
        <div class="field-label">Type:</div>
        <div class="field-value">${escapeHtml(data.type)}</div>

        <div class="field-label">Email:</div>
        <div class="field-value">${escapeHtml(data.email)}</div>

        <div class="field-label">Subject:</div>
        <div class="field-value">${escapeHtml(data.subject)}</div>

        <div class="field-label">Description:</div>
        <div class="field-value">${escapeHtml(data.description)}</div>
      </div>
      <div class="footer">
        This is an automated message from F3 Nation. Please do not reply to this email.
      </div>
    </div>
  </body>
</html>`,

  [Templates.mapChangeRequest]: (data: MapChangeRequestData) => `<html>
  <head><style>${emailStyles}</style></head>
  <body>
    <div class="container">
      <div class="header">F3 Map Change Request</div>
      <div class="content">
        <p>
          There's a new
          <span class="highlight">${escapeHtml(data.requestType)}</span>
          map change request for your region:
        </p>
        <p>
          <strong>Region:</strong> ${escapeHtml(data.regionName)}<br />
          <strong>Workout Name:</strong> ${escapeHtml(data.workoutName)}<br />
          <strong>Request Type:</strong> ${escapeHtml(data.requestType)}<br />
          <strong>Submitted By:</strong> ${escapeHtml(data.submittedBy)}
        </p>

        ${
          data.recipientRole
            ? `<div class="role-info">
            <p>You're receiving this email because you are an
              <strong>${escapeHtml(data.recipientRole)}</strong>
              for
              <strong>${escapeHtml(data.recipientOrg ?? "")}</strong>.</p>
          </div>`
            : ""
        }

        ${
          data.noAdminsNotice
            ? `<div class="notice">
            <p>You're receiving this email because there are no editors or
              admins assigned to this region.</p>
            <p>Please go to the users management page to assign editors or
              admins to this region.</p>
          </div>`
            : ""
        }

        <p>
          <a href="${escapeHtml(data.requestsUrl)}" class="action-button">View Request</a>
        </p>
      </div>
      <div class="footer">
        This is an automated message from F3 Nation. Please do not reply to this email.
      </div>
    </div>
  </body>
</html>`,

  [Templates.regionInABox]: (data: RegionInABoxData) => `<html>
  <head><style>${emailStyles}</style></head>
  <body>
    <div class="container">
      <div class="header">Welcome to the F3 Nation Map!</div>
      <div class="content">
        <p>Dear leaders of <span class="highlight">${escapeHtml(data.regionName)}</span>,</p>
        <p>
          Congratulations — you are now approved and have your first workout on the F3 Nation map!
          We'd love to send you a bundle of materials to help you get started and accelerate your
          region's growth.
        </p>
        <p><strong>The Region-in-a-Box bundle includes:</strong></p>
        <ul>
          <li>1 F3 Knitted Polyester Flag</li>
          <li>2 F3 Freed to Lead Book — 2nd Edition</li>
          <li>2 F3 Q Source Book</li>
          <li>1 F3 Stencil — "Worm's Coupon Maker"</li>
          <li>10 F3 Stickers</li>
          <li>10 F3 Business Cards</li>
        </ul>
        <p><strong>To claim your free bundle, here's what to do:</strong></p>
        <ol>
          <li>
            <strong>Reply all</strong> to this email and let us know you'd like to take advantage of
            the bundle. One of us will respond with two coupon codes — one to make the bundle free
            and one to cover shipping.
          </li>
          <li>
            Head to the product page:
            <a href="https://f3gear.com/products/f3-region-in-a-box-tier1">
              https://f3gear.com/products/f3-region-in-a-box-tier1
            </a>
            and add it to your cart.
          </li>
          <li>
            Enter your shipping details and apply <strong>both coupon codes</strong> at checkout to
            receive the bundle at no cost.
          </li>
        </ol>
        <p>
          We are excited to have <span class="highlight">${escapeHtml(data.regionName)}</span> as
          part of the F3 Nation community. Keep up the great work!
        </p>
      </div>
      <div class="footer">
        This message was sent by F3 Nation. Please reply all to respond to the full team.
      </div>
    </div>
  </body>
</html>`,
};

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
}

/**
 * Render a template with type-safe data
 */
export function renderTemplate<T extends Templates>(
  template: T,
  data: TemplateType[T],
): string {
  const renderer = templateRenderers[template];
  return renderer(data);
}
