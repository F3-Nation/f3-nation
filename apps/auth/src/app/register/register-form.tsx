"use client";

import {
  Suspense,
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPhoneNumber } from "libphonenumber-js";
import type { PhoneCountry } from "~/lib/phone";

import Image from "next/image";

import { detectPhoneCountry } from "~/lib/phone";
import { PhoneField } from "~/app/components/PhoneField";
import { RegionPicker } from "~/app/components/region-picker";
import type { Region } from "~/app/components/region-picker";
import { isValidCallbackUrl } from "~/lib/callback-url";
import { authClient } from "~/lib/better-auth-client";

// When the emailed code is rejected (usually because it expired while the
// form was being filled in), the answers are kept for this tab so asking for
// a fresh code doesn't mean typing them all again. Phone numbers and the
// emergency contact stay out of it: browser storage is plain text, and those
// are worth retyping rather than leaving behind on a shared computer.
const DRAFT_KEY = "f3-register-draft";

const subscribeToHydration = () => () => {
  // Hydration changes the snapshot once; no external events need a listener.
};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

interface RegisterDraft {
  email: string;
  f3Name: string;
  firstName: string;
  lastName: string;
  homeRegionId: number | "";
  regionSearch: string;
}

function saveDraft(draft: RegisterDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable — the form still works, just without a draft */
  }
}

function loadDraft(email: string): RegisterDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as RegisterDraft) : null;
    return draft?.email === email ? draft : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

export default function RegisterForm({
  useBetterAuth,
}: {
  useBetterAuth: boolean;
}) {
  return (
    <Suspense>
      <RegistrationAttempt useBetterAuth={useBetterAuth} />
    </Suspense>
  );
}

function RegistrationAttempt({ useBetterAuth }: { useBetterAuth: boolean }) {
  const searchParams = useSearchParams();
  const attemptKey = JSON.stringify([
    searchParams.get("email"),
    searchParams.get("code"),
  ]);
  return <RegisterFormInner key={attemptKey} useBetterAuth={useBetterAuth} />;
}

function RegisterFormInner({ useBetterAuth }: { useBetterAuth: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const code = searchParams.get("code") ?? "";
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [f3Name, setF3Name] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [homeRegionId, setHomeRegionId] = useState<number | "">("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry>("US");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyPhoneCountry, setEmergencyPhoneCountry] =
    useState<PhoneCountry>("US");
  const [emergencyNotes, setEmergencyNotes] = useState("");

  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [error, setError] = useState("");
  const [needsSignInAgain, setNeedsSignInAgain] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [regionSearch, setRegionSearch] = useState("");
  const submittingRef = useRef(false);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientSnapshot,
    serverSnapshot,
  );
  const [initialized, setInitialized] = useState(false);

  // Restore browser defaults after hydration without resetting user edits
  // on ordinary rerenders.
  if (hydrated && !initialized) {
    setInitialized(true);
    const detectedCountry = detectPhoneCountry(navigator.language);
    setPhoneCountry(detectedCountry);
    setEmergencyPhoneCountry(detectedCountry);
    const draft = loadDraft(email);
    if (draft) {
      setF3Name(draft.f3Name);
      setFirstName(draft.firstName);
      setLastName(draft.lastName);
      setHomeRegionId(draft.homeRegionId);
      setRegionSearch(draft.regionSearch);
    }
  }

  useEffect(() => {
    fetch("/api/regions")
      .then((res) => res.json())
      .then((data: Region[]) => setRegions(data))
      .catch(() => {
        /* regions are optional */
      });
  }, []);

  // If no email or code, redirect back to login
  useEffect(() => {
    if (!email || !code) {
      router.push("/login");
    }
  }, [email, code, router]);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current || needsSignInAgain) return;

    setLoading(true);
    setError("");

    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      setLoading(false);
      return;
    }

    if (phone && !isValidPhoneNumber(phone, phoneCountry)) {
      setError("Please enter a valid phone number.");
      setLoading(false);
      return;
    }

    if (
      emergencyPhone &&
      !isValidPhoneNumber(emergencyPhone, emergencyPhoneCountry)
    ) {
      setError("Please enter a valid emergency phone number.");
      setLoading(false);
      return;
    }

    submittingRef.current = true;
    let accountCreated = false;

    try {
      // Create user via API — backend-agnostic, creates the `users` row
      // through the F3 API regardless of which auth backend completes the
      // sign-in below.
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code,
          f3Name: f3Name || undefined,
          firstName,
          lastName,
          homeRegionId: homeRegionId || undefined,
          phone: phone || undefined,
          emergencyContact: emergencyContact || undefined,
          emergencyPhone: emergencyPhone || undefined,
          emergencyNotes: emergencyNotes || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Registration failed. Please try again.");
        // A rejected code can't be fixed from this form: keep the answers
        // for this tab and offer a fresh code.
        if (res.status === 401) {
          saveDraft({
            email,
            f3Name,
            firstName,
            lastName,
            homeRegionId,
            regionSearch,
          });
          setNeedsSignInAgain(true);
        }
        return;
      }
      clearDraft();

      accountCreated = true;

      // User created — now sign in with the original MFA code. The `users`
      // row exists now, so Better Auth's databaseHooks.user.create.before
      // (apps/auth/src/lib/better-auth.ts) finds it and bridges the id.
      if (useBetterAuth) {
        const { error: signInError } = await authClient.signIn.emailOtp({
          email,
          otp: code,
        });
        if (signInError) {
          // The account was already created above in both branches —
          // retrying via the "Create Account" button (the only other
          // control on this page) would re-post to /api/register, which
          // the F3 API rejects as a duplicate email. Every branch here
          // needs a path to sign in instead of "try again" on this form.
          setError(
            signInError.status === 429
              ? "Your account was created, but you've hit the sign-in rate limit. Please wait a moment, then sign in again to continue."
              : "Your account was created, but your code has expired. Please sign in again to continue.",
          );
          setNeedsSignInAgain(true);
          return;
        }
      } else {
        const result = await signIn("email-mfa", {
          email,
          code,
          redirect: false,
        });

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- next-auth's signIn resolves undefined when it redirects
        if (result?.error) {
          setError(
            "Your account was created, but your code has expired. Please sign in again to continue.",
          );
          setNeedsSignInAgain(true);
          return;
        }
      }

      const safeUrl = isValidCallbackUrl(callbackUrl, window.location.origin)
        ? callbackUrl
        : "/";
      router.push(safeUrl);
      setRegistrationComplete(true);
    } catch {
      if (accountCreated) {
        setError(
          "Your account was created, but we couldn't sign you in. Please sign in again to continue.",
        );
        setNeedsSignInAgain(true);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      // A confirmed account must not be registered again, even before navigation unmounts the form.
      submittingRef.current = accountCreated;
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-md border bg-background px-4 py-3 text-base outline-hidden focus:ring-2 focus:ring-ring";

  return (
    <div className="min-h-screen bg-card sm:bg-background">
      <div className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6 lg:py-16">
        <div className="space-y-8 sm:rounded-xl sm:bg-card sm:p-8 sm:shadow-lg lg:p-10">
          <div className="flex flex-col items-center space-y-4">
            <Image
              src="/f3nation.svg"
              alt="F3 Nation Logo"
              width={100}
              height={100}
              priority
            />
            <h1 className="text-3xl font-bold">Create Your Account</h1>
            <p className="text-center text-base text-muted-foreground">
              Welcome to F3 Nation! Fill in your details to get started.
            </p>
            <p className="text-base font-medium">{email}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="mb-2 block text-base font-medium"
                >
                  First Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="lastName"
                  className="mb-2 block text-base font-medium"
                >
                  Last Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="f3Name"
                className="mb-2 block text-base font-medium"
              >
                F3 Name
              </label>
              <input
                id="f3Name"
                type="text"
                value={f3Name}
                onChange={(e) => setF3Name(e.target.value)}
                placeholder="The name you got in the gloom"
                className={inputClass}
              />
            </div>

            <RegionPicker
              regions={regions}
              value={homeRegionId}
              onChange={setHomeRegionId}
              search={regionSearch}
              onSearchChange={setRegionSearch}
              inputClass={inputClass}
              placeholder="Search for a region (optional)"
            />

            <div>
              <PhoneField
                id="phone"
                label="Phone Number"
                placeholder="Optional phone number"
                value={phone}
                onChange={setPhone}
                country={phoneCountry}
                onCountryChange={setPhoneCountry}
              />
              <p className="mt-2 text-sm text-muted-foreground">
                Choose the number&apos;s country. International numbers with a
                leading `+` are also supported.
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowEmergency(!showEmergency)}
                className="text-base text-muted-foreground transition-colors hover:text-foreground"
              >
                {showEmergency ? "▾" : "▸"} Emergency Contact Info
              </button>
            </div>

            {showEmergency && (
              <div className="space-y-4 rounded-md border p-4">
                <div>
                  <label
                    htmlFor="emergencyContact"
                    className="mb-2 block text-base font-medium"
                  >
                    Emergency Contact Name
                  </label>
                  <input
                    id="emergencyContact"
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    placeholder="Jane Doe"
                    className={inputClass}
                  />
                </div>
                <PhoneField
                  id="emergencyPhone"
                  label="Emergency Phone"
                  placeholder="Optional emergency phone number"
                  value={emergencyPhone}
                  onChange={setEmergencyPhone}
                  country={emergencyPhoneCountry}
                  onCountryChange={setEmergencyPhoneCountry}
                />
                <div>
                  <label
                    htmlFor="emergencyNotes"
                    className="mb-2 block text-base font-medium"
                  >
                    Notes
                  </label>
                  <textarea
                    id="emergencyNotes"
                    value={emergencyNotes}
                    onChange={(e) => setEmergencyNotes(e.target.value)}
                    placeholder="Allergies, medical conditions, etc."
                    rows={3}
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="space-y-2">
                <p className="text-base text-destructive">{error}</p>
                {needsSignInAgain && (
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/login/email?callbackUrl=${encodeURIComponent(callbackUrl)}`,
                      )
                    }
                    className="text-base text-primary underline hover:no-underline"
                  >
                    Sign in again
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || needsSignInAgain || registrationComplete}
              className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
