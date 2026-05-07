import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSaveRegister } from "@/lib/save-context";
import type { UserProfile, UserMeta } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileFormState {
  f3Name: string;
  firstName: string;
  lastName: string;
  phone: string;
  homeRegionId: number | null;
  avatarUrl: string | null;
  emergencyContact: string;
  emergencyPhone: string;
  emergencyNotes: string;
  f3_name_origin: string;
  my_f3_why: string;
  user_emergency_info_dr_sharing: boolean;
  start_date_override: string;
  brought_by: number | null;
}

export interface UseProfileFormReturn {
  form: ProfileFormState;
  saving: boolean;
  isDirty: boolean;
  isFieldDirty: (key: keyof ProfileFormState) => boolean;
  /** CSS class helper that adds a left-border indicator on dirty fields. */
  dirtyClass: (key: keyof ProfileFormState) => string;
  updateField: <K extends keyof ProfileFormState>(
    key: K,
    value: ProfileFormState[K],
  ) => void;
  handleSave: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Parse the polymorphic `meta` field into a typed object. */
export function parseMeta(
  meta: string | Record<string, unknown> | null,
): UserMeta {
  if (!meta) return {};
  if (typeof meta === "object") return meta as UserMeta;
  try {
    return JSON.parse(meta) as UserMeta;
  } catch {
    return {};
  }
}

/** Derive initial form state from a UserProfile. */
export function buildInitialFormState(user: UserProfile): ProfileFormState {
  const meta = parseMeta(user.meta);
  return {
    f3Name: user.f3Name ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    phone: user.phone ?? "",
    homeRegionId: user.homeRegionId,
    avatarUrl: user.avatarUrl
      ? `${user.avatarUrl}?v=${new Date(user.updated).getTime()}`
      : null,
    emergencyContact: user.emergencyContact ?? "",
    emergencyPhone: user.emergencyPhone ?? "",
    emergencyNotes: user.emergencyNotes ?? "",
    f3_name_origin: meta.f3_name_origin ?? "",
    my_f3_why: meta.my_f3_why ?? "",
    user_emergency_info_dr_sharing:
      meta.user_emergency_info_dr_sharing ?? false,
    start_date_override: meta.start_date_override ?? "",
    brought_by: (meta.brought_by as number | null) ?? null,
  };
}

/**
 * Build the PATCH payload containing only dirty fields.
 * Coerces empty strings to `null` for nullable database columns.
 */
export function buildDirtyPayload(
  form: ProfileFormState,
  initial: ProfileFormState,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const keys = Object.keys(form) as (keyof ProfileFormState)[];

  const nullableFields = new Set([
    "firstName",
    "phone",
    "emergencyContact",
    "emergencyPhone",
    "emergencyNotes",
  ]);

  for (const key of keys) {
    if (form[key] === initial[key]) continue;
    // Skip avatarUrl — uploaded separately
    if (key === "avatarUrl") continue;

    const value = form[key];
    // Coerce empty strings to null for nullable text fields
    if (typeof value === "string" && value === "") {
      payload[key] = nullableFields.has(key) ? null : "";
    } else {
      payload[key] = value;
    }
  }

  return payload;
}

/** Returns a CSS class string for the dirty-field left-border indicator. */
export function dirtyFieldClass(isDirty: boolean): string {
  return isDirty
    ? " pl-2 border-l-[3px] border-l-amber-500"
    : " pl-2 border-l-[3px] border-l-transparent";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseProfileFormOptions {
  user: UserProfile;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "destructive";
  }) => void;
}

export function useProfileForm({
  user,
  toast,
}: UseProfileFormOptions): UseProfileFormReturn {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileFormState>(() =>
    buildInitialFormState(user),
  );
  const [initialForm, setInitialForm] = useState<ProfileFormState>(() =>
    buildInitialFormState(user),
  );

  const isFieldDirty = useCallback(
    (key: keyof ProfileFormState) => form[key] !== initialForm[key],
    [form, initialForm],
  );

  const isDirty = useMemo(
    () =>
      (Object.keys(form) as (keyof ProfileFormState)[]).some(
        (key) => key !== "avatarUrl" && form[key] !== initialForm[key],
      ),
    [form, initialForm],
  );

  const dirtyClass = useCallback(
    (key: keyof ProfileFormState) => dirtyFieldClass(isFieldDirty(key)),
    [isFieldDirty],
  );

  const updateField = useCallback(
    <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload = buildDirtyPayload(form, initialForm);

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to save profile");
      }

      setInitialForm({ ...form });

      toast({
        title: "Profile saved",
        description: "Your changes have been saved successfully.",
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [form, initialForm, toast]);

  // Sync form state when the user record changes (e.g. after navigation to a different user)
  useEffect(() => {
    const fresh = buildInitialFormState(user);
    setForm(fresh);
    setInitialForm(fresh);
  }, [user.id]);

  // Keep a stable ref to handleSave for the context registration
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  // Register save state with the navbar; unregister on unmount to clear stale state
  const { register, unregister } = useSaveRegister();
  useEffect(() => {
    register({ isDirty, saving, onSave: () => void saveRef.current() });
  }, [isDirty, saving, register]);
  useEffect(() => {
    return () => {
      unregister();
    };
  }, [unregister]);

  return {
    form,
    saving,
    isDirty,
    isFieldDirty,
    dirtyClass,
    updateField,
    handleSave,
  };
}
