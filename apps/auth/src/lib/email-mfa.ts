import crypto from "crypto";

import { createTransport } from "nodemailer";

import { and, count, desc, eq, gt, isNull, lt, sql } from "@acme/db";
import { emailMfaCodes, users } from "@acme/db/schema/schema";

import { isValidCallbackUrl } from "~/lib/callback-url";
import { constantTimeEqual } from "~/lib/crypto-utils";
import { db } from "~/lib/db";
import { logWarn } from "~/lib/logging";
import { NO_TRACKING_HEADERS } from "~/lib/mail-headers";
import { env } from "~/env";

const MAX_ATTEMPTS = 5;
const CODE_TTL_MINUTES = 10;

// Each code allows MAX_ATTEMPTS guesses, so the number of codes an address
// can be sent bounds how fast anyone can guess their way into the account,
// and how often they can make F3's mail sender email it.
const MAX_SENDS_PER_HOUR = 5;
const SEND_COOLDOWN = sql`interval '30 seconds'`;
const SEND_WINDOW = sql`interval '1 hour'`;

/** A code send was refused because the address was sent codes too recently. */
export class EmailCodeRateLimitedError extends Error {
  constructor() {
    super("Too many codes requested for this address");
    this.name = "EmailCodeRateLimitedError";
  }
}

type DbExecutor = Pick<typeof db, "update" | "insert">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const normalizeEmail = (email: string) => email.toLowerCase().trim();

/**
 * Whether the address may be sent another code: none within the cooldown,
 * and fewer than MAX_SENDS_PER_HOUR in the last hour. Every send, from either
 * auth backend and of any code type, leaves one email_mfa_codes row, so the
 * count holds across instances.
 */
async function isUnderSendLimit(
  executor: Pick<typeof db, "select">,
  normalizedEmail: string,
): Promise<boolean> {
  const utcNow = sql`timezone('utc'::text, now())`;
  const [recent] = await executor
    .select({
      inWindow: count(),
      inCooldown: count(
        sql`case when ${emailMfaCodes.createdAt} > ${utcNow} - ${SEND_COOLDOWN} then 1 end`,
      ),
    })
    .from(emailMfaCodes)
    .where(
      and(
        eq(emailMfaCodes.email, normalizedEmail),
        gt(emailMfaCodes.createdAt, sql`${utcNow} - ${SEND_WINDOW}`),
      ),
    );
  return !(
    recent &&
    (recent.inCooldown > 0 || recent.inWindow >= MAX_SENDS_PER_HOUR)
  );
}

/** Serializes sends to one address until the transaction ends. */
async function lockAddress(tx: Transaction, normalizedEmail: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`email-mfa-send:${normalizedEmail}`}))`,
  );
}

/** Uses up the address's active codes, so only the next one stored works. */
async function invalidateActiveCodes(
  executor: DbExecutor,
  normalizedEmail: string,
) {
  await executor
    .update(emailMfaCodes)
    .set({ consumedAt: new Date().toISOString() })
    .where(
      and(
        eq(emailMfaCodes.email, normalizedEmail),
        isNull(emailMfaCodes.consumedAt),
        gt(emailMfaCodes.expiresAt, new Date().toISOString()),
      ),
    );
}

/**
 * Count the address's recent sends and, if it is under the limit, run
 * `record` to add this send's row, all under a per-address lock so parallel
 * sends can't each see room for one more. Throws EmailCodeRateLimitedError
 * without running `record` otherwise.
 */
async function reserveSend(
  normalizedEmail: string,
  record: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockAddress(tx, normalizedEmail);
    if (!(await isUnderSendLimit(tx, normalizedEmail))) {
      throw new EmailCodeRateLimitedError();
    }
    await record(tx);
  });
}

/**
 * The code_hash of a send reserved before its code exists. No hash of a real
 * code equals it, and its row is stored already used, so nothing can check it.
 */
const RESERVED_CODE_HASH = "reserved";

/**
 * Reserve one send to the address before its code is generated: under the
 * per-address lock, check the limit and, if there's room, add a placeholder
 * row that counts toward it. Returns false, reserving nothing, when the
 * address is over the limit.
 *
 * Better Auth stores each code it generates before calling its delivery
 * callback, so the limit has to be settled before generation. Otherwise a
 * refused request would already have replaced the code a parallel request
 * emailed. recordEmailCode then attaches the real code to this reservation.
 * A reservation whose code is never sent (the endpoint declined to send)
 * still counts toward the limit.
 */
export async function reserveEmailCodeSend(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  try {
    await reserveSend(normalizedEmail, async (tx) => {
      const now = new Date().toISOString();
      await tx.insert(emailMfaCodes).values({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        codeHash: RESERVED_CODE_HASH,
        expiresAt: now,
        consumedAt: now,
        attemptCount: 0,
      });
    });
    return true;
  } catch (err) {
    if (err instanceof EmailCodeRateLimitedError) return false;
    throw err;
  }
}

let _transporter: ReturnType<typeof createTransport> | null = null;
function getTransporter() {
  _transporter ??= createTransport(env.EMAIL_SERVER);
  return _transporter;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Hash-store a code for an already-normalized email, invalidating any
 * previous active code for that email.
 */
async function storeCode(
  normalizedEmail: string,
  code: string,
  executor: DbExecutor = db,
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  await invalidateActiveCodes(executor, normalizedEmail);

  // Insert new code
  await executor.insert(emailMfaCodes).values({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    codeHash: hashCode(code),
    expiresAt,
    attemptCount: 0,
  });
}

/**
 * Record a code that something else generated and is about to email (Better
 * Auth's emailOTP plugin) as one send toward the address's limit.
 *
 * The send normally fills in the reservation reserveEmailCodeSend made for it
 * before the code was generated, so it isn't counted twice. Without one (a
 * caller that skipped the reservation), it is counted here under the lock
 * instead, and throws EmailCodeRateLimitedError, recording nothing, when the
 * address is over the limit.
 *
 * A `checkable` code (sign-in) becomes the address's active code, since
 * Better Auth's own store can't be checked without consuming the code; this
 * lets /api/register prove email ownership with checkEmailCode on either auth
 * backend. Any other code is stored already used: no check can match it, and
 * the active sign-in code stays valid.
 */
export async function recordEmailCode(
  email: string,
  code: string,
  { checkable }: { checkable: boolean },
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  await db.transaction(async (tx) => {
    await lockAddress(tx, normalizedEmail);
    const utcNow = sql`timezone('utc'::text, now())`;
    const [reservation] = await tx
      .select({ id: emailMfaCodes.id })
      .from(emailMfaCodes)
      .where(
        and(
          eq(emailMfaCodes.email, normalizedEmail),
          eq(emailMfaCodes.codeHash, RESERVED_CODE_HASH),
          gt(emailMfaCodes.createdAt, sql`${utcNow} - ${SEND_WINDOW}`),
        ),
      )
      .orderBy(desc(emailMfaCodes.createdAt))
      .limit(1);
    if (!reservation && !(await isUnderSendLimit(tx, normalizedEmail))) {
      throw new EmailCodeRateLimitedError();
    }

    const now = new Date().toISOString();
    if (checkable) await invalidateActiveCodes(tx, normalizedEmail);
    const row = {
      codeHash: hashCode(code),
      ...(checkable
        ? {
            expiresAt: new Date(
              Date.now() + CODE_TTL_MINUTES * 60 * 1000,
            ).toISOString(),
            consumedAt: null,
          }
        : { expiresAt: now, consumedAt: now }),
    };
    if (reservation) {
      await tx
        .update(emailMfaCodes)
        .set(row)
        .where(eq(emailMfaCodes.id, reservation.id));
    } else {
      await tx.insert(emailMfaCodes).values({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        attemptCount: 0,
        ...row,
      });
    }
  });
}

/**
 * Generate a 6-digit code, hash-store it, and email it to the user.
 * Invalidates any previous active code for that email.
 *
 * Throws EmailCodeRateLimitedError, sending nothing, when the address was sent
 * a code within the cooldown or has had MAX_SENDS_PER_HOUR in the last hour.
 * The count lives in email_mfa_codes and is taken under a per-address lock,
 * so the limit holds across instances and parallel requests.
 *
 * @param callbackUrl - Optional URL to redirect to after sign-in via magic link.
 */
export async function sendEmailCode(
  email: string,
  callbackUrl?: string,
): Promise<void> {
  // Normalize early so all downstream usage (DB keys, magic link URL) is consistent.
  const normalizedEmail = normalizeEmail(email);

  // randomInt's upper bound is exclusive.
  const code = crypto.randomInt(100000, 1000000).toString();
  await reserveSend(normalizedEmail, (tx) =>
    storeCode(normalizedEmail, code, tx),
  );

  // Build the magic link — include callbackUrl so clicking the link lands
  // back in the originating app, not on the auth homepage.
  // Only embed the callbackUrl if it is same-origin or a relative path;
  // this prevents open-redirect attacks via crafted magic links.
  const authUrl = env.NEXT_PUBLIC_AUTH_URL;
  const verifyParams = new URLSearchParams({ email: normalizedEmail, code });
  if (callbackUrl && isValidCallbackUrl(callbackUrl, authUrl)) {
    verifyParams.set("callbackUrl", callbackUrl);
  } else if (callbackUrl) {
    // Log only origin + path of the rejected URL — enough for open-redirect
    // forensics, without persisting any query/fragment that could carry
    // injected tokens or PII.
    let sanitizedCallbackUrl: string;
    try {
      const parsed = new URL(callbackUrl, authUrl);
      sanitizedCallbackUrl = `${parsed.origin}${parsed.pathname}`;
    } catch {
      sanitizedCallbackUrl = "unparseable";
    }
    logWarn("auth.email_mfa.invalid_callback_url", {
      callbackUrl: sanitizedCallbackUrl,
    });
  }
  const magicLink = `${authUrl}/login/email/verify?${verifyParams.toString()}`;

  const transporter = getTransporter();

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: normalizedEmail,
    subject: "Your F3 Nation sign-in code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your verification code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px;">${code}</p>
        <p>This code expires in ${CODE_TTL_MINUTES} minutes.</p>
        <p>Or click the link below to sign in automatically:</p>
        <p><a href="${magicLink}">Sign in to F3 Nation</a></p>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
    headers: NO_TRACKING_HEADERS,
  });
}

/**
 * Find the active code row for this email and compare it to `code`. A
 * mismatch counts toward the brute-force lockout; a match gives its attempt
 * back, and is marked consumed when `consume` is set.
 */
async function findMatchingCode(
  email: string,
  code: string,
  { consume = false }: { consume?: boolean } = {},
) {
  // Same normalization storeCode's callers use.
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  // Find the active code for this email
  const [mfaCode] = await db
    .select()
    .from(emailMfaCodes)
    .where(
      and(
        eq(emailMfaCodes.email, normalizedEmail),
        isNull(emailMfaCodes.consumedAt),
        gt(emailMfaCodes.expiresAt, now),
      ),
    )
    .limit(1);

  if (!mfaCode) return null;

  // Claim an attempt before comparing, in one conditional update, so a burst
  // of parallel guesses can't all read "0 attempts used" and each get a free
  // try. A new code starts a fresh row.
  const [claimed] = await db
    .update(emailMfaCodes)
    .set({ attemptCount: sql`${emailMfaCodes.attemptCount} + 1` })
    .where(
      and(
        eq(emailMfaCodes.id, mfaCode.id),
        lt(emailMfaCodes.attemptCount, MAX_ATTEMPTS),
      ),
    )
    .returning({ id: emailMfaCodes.id });
  if (!claimed) return null;

  if (!constantTimeEqual(mfaCode.codeHash, hashCode(code))) return null;

  // Only wrong guesses count, so the owner's registration check and the
  // sign-in after it don't eat into their 5 tries. Consuming is conditional
  // on the code still being unused, so two parallel redemptions of the same
  // code can't both succeed.
  const [refunded] = await db
    .update(emailMfaCodes)
    .set({
      attemptCount: sql`${emailMfaCodes.attemptCount} - 1`,
      ...(consume && { consumedAt: now }),
    })
    .where(
      and(
        eq(emailMfaCodes.id, mfaCode.id),
        consume ? isNull(emailMfaCodes.consumedAt) : undefined,
      ),
    )
    .returning({ id: emailMfaCodes.id });
  if (consume && !refunded) return null;

  return mfaCode;
}

/**
 * Check a code without consuming it — proof that the caller owns `email`,
 * for steps (registration) that must run before the sign-in that consumes
 * the code. A wrong code spends one of the code's attempts, the same budget
 * sign-in draws on.
 */
export async function checkEmailCode(
  email: string,
  code: string,
): Promise<boolean> {
  return (await findMatchingCode(email, code)) !== null;
}

/**
 * Use up a code that has already been verified, without touching its
 * attempt budget. Claiming an attempt here could fail on a budget a parallel
 * check has momentarily filled, and leave the code unconsumed. Conditional
 * on the code still being unused, so it redeems at most once.
 */
async function redeemVerifiedCode(email: string, code: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  const [mfaCode] = await db
    .select()
    .from(emailMfaCodes)
    .where(
      and(
        eq(emailMfaCodes.email, normalizedEmail),
        isNull(emailMfaCodes.consumedAt),
        gt(emailMfaCodes.expiresAt, now),
      ),
    )
    .limit(1);
  if (!mfaCode || !constantTimeEqual(mfaCode.codeHash, hashCode(code))) {
    return false;
  }

  const [consumed] = await db
    .update(emailMfaCodes)
    .set({ consumedAt: now })
    .where(
      and(eq(emailMfaCodes.id, mfaCode.id), isNull(emailMfaCodes.consumedAt)),
    )
    .returning({ id: emailMfaCodes.id });
  return Boolean(consumed);
}

/**
 * Better Auth's claimOtpAttempt. Without `consume` it is checkEmailCode.
 * With `consume`, which only the after-sign-in hook passes once Better Auth
 * has verified the code, it uses the code up without spending an attempt,
 * so the email_mfa_codes copy can't be replayed at /api/register afterwards.
 */
export async function claimEmailCode(
  email: string,
  code: string,
  options: { consume: boolean },
): Promise<boolean> {
  if (options.consume) return redeemVerifiedCode(email, code);
  return (await findMatchingCode(email, code)) !== null;
}

/**
 * Verify a 6-digit code against the stored hash.
 * Returns the user if verification succeeds, null otherwise.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ id: number; email: string; f3Name: string | null } | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  const mfaCode = await findMatchingCode(email, code, { consume: true });
  if (!mfaCode) return null;

  // Find or signal user creation
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      f3Name: users.f3Name,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (user) {
    // Mark email as verified if not already (direct DB write — avoids
    // crupdate's roles-diffing which would wipe existing roles)
    if (!user.emailVerified) {
      await db
        .update(users)
        .set({ emailVerified: now })
        .where(eq(users.id, user.id));
    }
    return user;
  }

  // User doesn't exist — registration required
  return null;
}
