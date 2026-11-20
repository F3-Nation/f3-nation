"use client";

import { useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@acme/ui/alert-dialog";
import { Checkbox } from "@acme/ui/checkbox";

const PASSWORD_VAULT_HELP_URL = "https://help.passwords.f3nation.com";

const helpLink = (
  <a
    href={PASSWORD_VAULT_HELP_URL}
    target="_blank"
    rel="noreferrer"
    className="underline"
  >
    help.passwords.f3nation.com
  </a>
);

/**
 * The region's password vault opt-in, stored as `meta.password_vault_enabled`.
 * Changing the box away from the saved value asks for confirmation first,
 * because turning the vault off removes every member's access to it; the
 * change applies when the form saves.
 */
export function PasswordVaultField({
  checked,
  savedEnabled,
  onChange,
}: {
  checked: boolean;
  /** Whether the vault is enabled in the saved region. */
  savedEnabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [pending, setPending] = useState<boolean | null>(null);

  return (
    <>
      <div className="flex items-start gap-2">
        <Checkbox
          id="password-vault-enabled"
          checked={checked}
          onCheckedChange={(state) => {
            const next = state === true;
            // Going back to the saved value needs no warning.
            if (next === savedEnabled) onChange(next);
            else setPending(next);
          }}
        />
        <div className="grid gap-1">
          <label
            htmlFor="password-vault-enabled"
            className="text-sm leading-none font-medium"
          >
            Password vault
          </label>
          <p className="text-xs text-muted-foreground">
            A shared password vault for this region. Members with the Password
            Manager or Password Reader role on the region get access. Details at{" "}
            {helpLink}.
          </p>
        </div>
      </div>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent
          // This confirmation must sit above the editor's overlay.
          style={{ zIndex: Z_INDEX.DIALOG_OVERLAY + 1 }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? "Turn on the password vault?"
                : "Turn off the password vault?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {pending ? (
                  <p>
                    If you check this, a password vault will be created for your
                    region within the next hour. Once it is created, everyone
                    with the Password Manager or Password Reader role for this
                    region will be invited to it. See {helpLink} for full
                    details.
                  </p>
                ) : (
                  <p>
                    By unchecking this box, all members will be removed from
                    your region&apos;s password vault collection. Passwords will
                    not be deleted.
                  </p>
                )}
                <p>This takes effect when you save the region.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending !== null) onChange(pending);
                setPending(null);
              }}
            >
              {pending ? "Turn on" : "Turn off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
