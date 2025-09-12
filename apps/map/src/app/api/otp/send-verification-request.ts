import type { Theme } from "@auth/core/types";
import type { NodemailerConfig } from "next-auth/providers/nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  createTestAccount,
  createTransport,
  getTestMessageUrl,
} from "nodemailer";

import { authConfig } from "@acme/auth/config";
import { isProduction } from "@acme/shared/common/constants";

const SHOW_MOBILE = false as boolean;
const authConfigTheme = authConfig.theme;
const theme: Theme = {
  colorScheme: authConfigTheme?.colorScheme ?? "auto",
  logo: authConfigTheme?.logo ?? "/logo.png",
  brandColor: authConfigTheme?.brandColor ?? "#000000",
  buttonText: authConfigTheme?.buttonText ?? "Sign in",
};

export const sendVerificationRequest = async (
  params: Omit<
    Parameters<NodemailerConfig["sendVerificationRequest"]>[0],
    "provider" | "theme" | "expires" | "request"
  > & {
    server: NodemailerConfig["server"];
    from: NodemailerConfig["from"];
  },
) => {
  const { identifier, url, server, from, token } = params;
  const { host } = new URL(url);
  const protocol = url.split("://")[0] + "://";
  const search = new URL(url).search;
  const mobileUrl = SHOW_MOBILE
    ? `${protocol}${host}/redirect-to-app${search}`
    : undefined;

  // In dev, use ethereal.email as test account
  const transportOptions: SMTPTransport.Options = isProduction
    ? (server as SMTPTransport.Options)
    : await createTestAccount().then(({ user, pass }) => ({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user, pass },
      }));

  const transport = createTransport(transportOptions);
  const subject = `Authentication code: ${token}`;
  const result = await transport.sendMail({
    to: identifier,
    from: from,
    subject,
    text: text({ host, token }),
    html: html({ token, host, theme }),
  });
  const failed = result.rejected.concat(result.pending).filter(Boolean);
  if (failed.length) {
    throw new Error(
      `Email (${failed.map((f) => (typeof f === "string" ? f : f.address)).join(", ")}) could not be sent`,
    );
  }

  if (!isProduction) {
    console.log("Development email bypass!", {
      subject,
      etherealMail: getTestMessageUrl(result),
      mobileUrl,
      url,
    });
  }
};

/**
 * Email HTML body
 * Insert invisible space into domains from being turned into a hyperlink by email
 * clients like Outlook and Apple mail, as this is confusing because it seems
 * like they are supposed to click on it to sign in.
 *
 * @note We don't add the email address to avoid needing to escape it, if you do, remember to sanitize it!
 */
function html(params: { token: string; host: string; theme: Theme }) {
  const { token, host, theme } = params;

  const escapedHost = host.replace(/\./g, "&#8203;.");

  const brandColor = theme.brandColor ?? "#346df1";

  const buttonText = theme.buttonText ?? "#fff";

  const color = {
    background: "#f9f9f9",
    text: "#444",
    mainBackground: "#fff",
    buttonBackground: brandColor,
    buttonBorder: brandColor,
    buttonText,
  };

  return `
<body style="background: ${color.background};">
	<table width="100%" border="0" cellspacing="20" cellpadding="0"
		style="background: ${color.mainBackground}; max-width: 600px; margin: auto; border-radius: 10px;">
		<tr>
			<td align="center"
				style="padding: 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
				Sign in to <strong>${escapedHost}</strong> with this code:
			</td>
		</tr>
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table border="0" cellspacing="0" cellpadding="0">
					<tr>
						<td align="center" style="font-size: 24px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
							${token}
						</td>
					</tr>
				</table>
			</td>
		</tr>
		<tr>
			<td align="center"
				style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
				If you did not request this email you can safely ignore it.
			</td>
		</tr>
	</table>
</body>
`;
}

/** Email Text body (fallback for email clients that don't render HTML, e.g. feature phones) */
function text({ host, token }: { host: string; token: string }) {
  return `Sign in to ${host} in your browser with this code: ${token}\n`;
}

//   sendVerificationRequest: ({
//     identifier: email,
//     url,
//     token,
//     baseUrl,
//     provider,
//   }) => {
//     return new Promise((resolve, reject) => {
//       const { server, from } = provider;
//       // Strip protocol from URL and use domain as site name
//       const site = baseUrl.replace(/^https?:\/\//, "");

//       nodemailer.createTransport(server).sendMail(
//         {
//           to: email,
//           from,
//           subject: `Authentication code: ${token}`,
//           text: text({ url, site, email, token }),
//           html: html({ url, site, email, token }),
//         },
//         (error) => {
//           if (error) {
//             // logger.error('SEND_VERIFICATION_EMAIL_ERROR', email, error);
//             console.error("SEND_VERIFICATION_EMAIL_ERROR", email, error);
//             return reject(
//               new Error(`SEND_VERIFICATION_EMAIL_ERROR ${error}`)
//             );
//           }
//           return resolve();
//         }
//       );
//     });
//   },
// }),
