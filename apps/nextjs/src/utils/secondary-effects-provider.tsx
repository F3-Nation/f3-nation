"use client";

import { useEffect, useRef } from "react";

import { toast } from "@acme/ui/toast";

import { useAuth } from "./hooks/use-auth";
import { appStore } from "./store/app";
import { mapStore } from "./store/map";
import { ModalType, openModal } from "./store/modal";

export const SecondaryEffectsProvider = () => {
  const { status, session } = useAuth();
  const mode = appStore.use.mode();
  const initialEditMode = useRef<"view" | "edit">();

  // Show info about edit mode if it is on
  useEffect(() => {
    if (initialEditMode.current === undefined && appStore.hasHydrated) {
      initialEditMode.current = mode;
    }

    if (mode !== "edit") {
      mapStore.setState({
        updateLocation: null,
      });
    } else if (mode === "edit" && initialEditMode.current === "view") {
      toast.info("Edit mode is on", {
        action: {
          label: "Learn more",
          onClick: () => {
            openModal(ModalType.EDIT_MODE_INFO);
          },
        },
      });
    }
  }, [mode]);

  // Return mode to view if we are not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      appStore.setState({ mode: "view" });
    }
  }, [status]);

  // Set my email if we are authenticated
  useEffect(() => {
    if (session?.user?.email) {
      appStore.setState({ myEmail: session.user.email });
    }
  }, [session]);

  return null;
};
