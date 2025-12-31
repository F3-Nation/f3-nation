import { vi } from 'vitest';

/**
 * Captured email data from SendGrid mock
 */
export interface CapturedEmail {
  to: string;
  from: string;
  templateId: string;
  dynamicTemplateData: {
    code: string;
    magic_link: string;
    expires_at: string;
    expires_in_minutes: number;
  };
  timestamp: Date;
}

// Store for captured emails
let capturedEmails: CapturedEmail[] = [];

// Original fetch reference
let originalFetch: typeof global.fetch;

/**
 * Mock fetch implementation that intercepts SendGrid API calls.
 */
async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();

  // Intercept SendGrid API calls
  if (url.includes('api.sendgrid.com/v3/mail/send')) {
    if (init?.body) {
      const body = JSON.parse(init.body as string);
      const personalization = body.personalizations?.[0];

      if (personalization) {
        capturedEmails.push({
          to: personalization.to?.[0]?.email || '',
          from: body.from?.email || '',
          templateId: body.template_id || '',
          dynamicTemplateData: personalization.dynamic_template_data || {},
          timestamp: new Date(),
        });
      }
    }

    // Return successful response
    return new Response(null, {
      status: 202,
      statusText: 'Accepted',
    });
  }

  // For non-SendGrid requests, use original fetch
  return originalFetch(input, init);
}

/**
 * Setup the SendGrid mock.
 * Call this in beforeAll() or beforeEach().
 */
export function setupSendGridMock(): void {
  originalFetch = global.fetch;
  global.fetch = vi.fn(mockFetch) as typeof global.fetch;
  capturedEmails = [];
}

/**
 * Restore the original fetch.
 * Call this in afterAll() or afterEach().
 */
export function teardownSendGridMock(): void {
  if (originalFetch) {
    global.fetch = originalFetch;
  }
  capturedEmails = [];
}

/**
 * Get all captured emails.
 */
export function getCapturedEmails(): CapturedEmail[] {
  return [...capturedEmails];
}

/**
 * Get the last captured email.
 */
export function getLastCapturedEmail(): CapturedEmail | undefined {
  return capturedEmails[capturedEmails.length - 1];
}

/**
 * Find captured emails by recipient.
 */
export function findCapturedEmailsByRecipient(email: string): CapturedEmail[] {
  return capturedEmails.filter(e => e.to === email);
}

/**
 * Clear captured emails.
 * Call this between tests to reset state.
 */
export function clearCapturedEmails(): void {
  capturedEmails = [];
}

/**
 * Get the number of emails sent.
 */
export function getCapturedEmailCount(): number {
  return capturedEmails.length;
}

/**
 * Assert that an email was sent to a specific address.
 */
export function expectEmailSentTo(email: string): CapturedEmail {
  const found = capturedEmails.find(e => e.to === email);
  if (!found) {
    throw new Error(
      `Expected email to be sent to ${email}, but it was not. ` +
        `Emails sent to: ${capturedEmails.map(e => e.to).join(', ') || 'none'}`
    );
  }
  return found;
}

/**
 * Assert that no emails were sent.
 */
export function expectNoEmailsSent(): void {
  if (capturedEmails.length > 0) {
    throw new Error(
      `Expected no emails to be sent, but ${capturedEmails.length} were sent ` +
        `to: ${capturedEmails.map(e => e.to).join(', ')}`
    );
  }
}

/**
 * Create a SendGrid mock that fails with a specific error.
 */
export function setupSendGridMockWithError(
  statusCode: number = 500,
  errorBody: string = 'SendGrid error'
): void {
  originalFetch = global.fetch;
  global.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('api.sendgrid.com/v3/mail/send')) {
      return new Response(errorBody, {
        status: statusCode,
        statusText: 'Error',
      });
    }

    return originalFetch(input);
  }) as typeof global.fetch;
}
