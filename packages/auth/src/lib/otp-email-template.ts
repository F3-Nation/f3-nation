const color = {
  background: "#f9f9f9",
  text: "#444",
  mainBackground: "#fff",
};

interface OtpEmailParams {
  token: string;
  host: string;
}

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
 * Email HTML body.
 * Inserts a zero-width space into the host's domain so email clients like
 * Outlook and Apple Mail don't auto-link it. A linked domain is confusing
 * because it looks like something to click to sign in.
 *
 * `host` and `token` are HTML-escaped. The recipient address is deliberately
 * not rendered; if it is ever added, pass it through `escapeHtml` too.
 */
export function renderOtpEmailHtml({ token, host }: OtpEmailParams): string {
  // Escape before inserting the zero-width-space entity so it isn't re-escaped.
  const escapedHost = escapeHtml(host).replace(/\./g, "&#8203;.");
  const escapedToken = escapeHtml(token);

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
							${escapedToken}
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
export function renderOtpEmailText({ token, host }: OtpEmailParams): string {
  return `Sign in to ${host} in your browser with this code: ${token}\n`;
}
