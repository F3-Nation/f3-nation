"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPhoneNumber } from "libphonenumber-js";
import type { PhoneCountry } from "~/lib/phone";

import Image from "next/image";

import { detectPhoneCountry } from "~/lib/phone";
import { PhoneField } from "~/app/components/PhoneField";
import { isValidCallbackUrl } from "~/lib/callback-url";
import { authClient } from "~/lib/better-auth-client";

interface Region {
  id: number;
  name: string;
}

export default function RegisterForm({
  useBetterAuth,
}: {
  useBetterAuth: boolean;
}) {
  return (
    <Suspense>
      <RegisterFormInner useBetterAuth={useBetterAuth} />
    </Suspense>
  );
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
  const [error, setError] = useState("");
  const [needsSignInAgain, setNeedsSignInAgain] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [regionSearch, setRegionSearch] = useState("");
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const regionSelectedRef = useRef(false);

  useEffect(() => {
    fetch("/api/regions")
      .then((res) => res.json())
      .then((data: Region[]) => setRegions(data))
      .catch(() => {
        /* regions are optional */
      });
  }, []);

  useEffect(() => {
    const detectedCountry = detectPhoneCountry(navigator.language);
    setPhoneCountry(detectedCountry);
    setEmergencyPhoneCountry(detectedCountry);
  }, []);

  // Close region dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (regionRef.current && !regionRef.current.contains(e.target as Node)) {
        setRegionDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredRegions = regions.filter((r) =>
    r.name.toLowerCase().includes(regionSearch.toLowerCase()),
  );

  // If no email or code, redirect back to login
  useEffect(() => {
    if (!email || !code) {
      router.push("/login");
    }
  }, [email, code, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNeedsSignInAgain(false);

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

    try {
      // Create user via API — backend-agnostic, creates the `users` row
      // through the F3 API regardless of which auth backend completes the
      // sign-in below.
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
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
        return;
      }

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
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
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

            <div ref={regionRef} className="relative">
              <label
                htmlFor="homeRegion"
                className="mb-2 block text-base font-medium"
              >
                Home Region
              </label>
              <input
                id="homeRegion"
                type="text"
                value={regionSearch}
                onChange={(e) => {
                  setRegionSearch(e.target.value);
                  setHomeRegionId("");
                  setRegionDropdownOpen(true);
                }}
                onFocus={() => setRegionDropdownOpen(true)}
                onBlur={() => {
                  setTimeout(() => {
                    if (!regionSelectedRef.current) {
                      if (homeRegionId) {
                        // Restore the selected region name if user didn't change selection
                        const selected = regions.find(
                          (r) => r.id === homeRegionId,
                        );
                        if (selected) {
                          setRegionSearch(selected.name);
                        }
                      } else {
                        setRegionSearch("");
                      }
                    }
                    regionSelectedRef.current = false;
                    setRegionDropdownOpen(false);
                  }, 200);
                }}
                placeholder="Search for a region (optional)"
                autoComplete="off"
                className={inputClass}
              />
              {regionDropdownOpen && filteredRegions.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-card shadow-lg">
                  {filteredRegions.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onMouseDown={() => {
                          regionSelectedRef.current = true;
                        }}
                        onClick={() => {
                          setHomeRegionId(r.id);
                          setRegionSearch(r.name);
                          setRegionDropdownOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-base transition-colors hover:bg-accent"
                      >
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {regionDropdownOpen &&
                regionSearch &&
                filteredRegions.length === 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-card px-4 py-3 text-base text-muted-foreground shadow-lg">
                    No regions found
                  </div>
                )}
            </div>

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
              disabled={loading}
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
