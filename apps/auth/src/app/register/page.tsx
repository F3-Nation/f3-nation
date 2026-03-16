"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

import ThemeImage from "~/app/components/ThemeImage";

interface Region {
  id: number;
  name: string;
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
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
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyNotes, setEmergencyNotes] = useState("");

  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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

    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      setLoading(false);
      return;
    }

    // Create user via API
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
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Registration failed. Please try again.");
      setLoading(false);
      return;
    }

    // User created — now sign in with the original MFA code
    const result = await signIn("email-mfa", {
      email,
      code,
      redirect: false,
    });

    if (result?.error) {
      setError("Your verification code has expired. Please start over.");
      setLoading(false);
      return;
    }

    router.push(callbackUrl);
  }

  const inputClass =
    "w-full rounded-md border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center py-10">
      <div className="w-full max-w-lg space-y-8 rounded-lg border bg-card p-10 shadow-sm">
        <div className="flex flex-col items-center space-y-4">
          <ThemeImage
            src="/f3nation.svg"
            alt="F3 Nation Logo"
            width={100}
            height={100}
            priority
          />
          <h1 className="text-3xl font-bold">Create Your Account</h1>
          <p className="text-base text-muted-foreground text-center">
            Welcome to F3 Nation! Fill in your details to get started.
          </p>
          <p className="text-base font-medium">{email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="firstName"
                className="block text-base font-medium mb-2"
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
                className="block text-base font-medium mb-2"
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
              className="block text-base font-medium mb-2"
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
              className="block text-base font-medium mb-2"
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
                    setRegionSearch("");
                    setHomeRegionId("");
                  }
                  regionSelectedRef.current = false;
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
                      className="w-full px-4 py-2 text-left text-base hover:bg-accent transition-colors"
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
            <label htmlFor="phone" className="block text-base font-medium mb-2">
              Phone Number
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className={inputClass}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowEmergency(!showEmergency)}
              className="text-base text-muted-foreground hover:text-foreground transition-colors"
            >
              {showEmergency ? "▾" : "▸"} Emergency Contact Info
            </button>
          </div>

          {showEmergency && (
            <div className="space-y-4 rounded-md border p-4">
              <div>
                <label
                  htmlFor="emergencyContact"
                  className="block text-base font-medium mb-2"
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
              <div>
                <label
                  htmlFor="emergencyPhone"
                  className="block text-base font-medium mb-2"
                >
                  Emergency Phone
                </label>
                <input
                  id="emergencyPhone"
                  type="tel"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  placeholder="(555) 987-6543"
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="emergencyNotes"
                  className="block text-base font-medium mb-2"
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

          {error && <p className="text-base text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
