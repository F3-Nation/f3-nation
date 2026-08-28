"use client";

import { Plus } from "lucide-react";

import { Button } from "@acme/ui/button";

import { ModalType, openModal } from "~/utils/store/modal";

export const CreateOauthClientButton = () => {
  return (
    <Button
      onClick={() => openModal(ModalType.ADMIN_OAUTH_CLIENTS, null)}
      className="inline-flex items-center gap-2"
    >
      <Plus className="h-4 w-4" />
      New OAuth Client
    </Button>
  );
};
