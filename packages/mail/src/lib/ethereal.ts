export async function createEtherealTestAccount(): Promise<{
  user: string;
  pass: string;
}> {
  const apiUrl = process.env.ETHEREAL_API ?? "https://api.nodemailer.com";
  const apiKey = process.env.ETHEREAL_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${apiUrl}/user`, {
    method: "POST",
    headers,
    body: JSON.stringify({ requestor: "nodemailer", version: "6.10.0" }),
  });

  const data = (await response.json().catch(() => null)) as {
    status?: string;
    error?: string;
    user?: string;
    pass?: string;
  } | null;

  if (!response.ok) {
    const reason = data?.error ?? `${response.status} ${response.statusText}`;
    throw new Error(`Failed to create Ethereal test account: ${reason}`);
  }

  if (data?.status && data.status !== "success") {
    throw new Error(
      `Failed to create Ethereal test account: ${
        data.error ?? `Unexpected status: ${data.status}`
      }`,
    );
  }

  if (!data?.user || !data.pass) {
    throw new Error(
      "Failed to create Ethereal test account: Missing credentials",
    );
  }

  return { user: data.user, pass: data.pass };
}
