"use client";

import { KeyRound } from "lucide-react";

import { Button } from "@acme/ui/button";

import { ModalType, openModal } from "~/utils/store/modal";

export const CreateApiKeyButton = () => {
  return (
    <Button
      onClick={() => openModal(ModalType.ADMIN_API_KEYS)}
      className="inline-flex items-center gap-2"
    >
      <KeyRound className="h-4 w-4" />
      New API Key
    </Button>
  );
};
