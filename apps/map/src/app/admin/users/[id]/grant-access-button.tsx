"use client";

import { UserPlus } from "lucide-react";

import { cn } from "@acme/ui";

import { ModalType, openModal } from "~/utils/store/modal";

export const GrantAccessButton = () => {
  return (
    <button
      onClick={() => {
        openModal(ModalType.ADMIN_GRANT_ACCESS, null);
      }}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        "h-9 px-4 py-2",
      )}
    >
      <UserPlus className="mr-2 h-4 w-4" />
      Manage Access
    </button>
  );
};
