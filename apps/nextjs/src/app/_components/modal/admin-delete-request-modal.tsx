"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TRPCClientError } from "@trpc/client";
import { Trash } from "lucide-react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { Button } from "@acme/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
import { Spinner } from "@acme/ui/spinner";
import { toast } from "@acme/ui/toast";

import type { DataType, ModalType } from "~/utils/store/modal";
import { api } from "~/trpc/react";
import { vanillaApi } from "~/trpc/vanilla";
import { closeModal, modalStore } from "~/utils/store/modal";

export default function AdminDeleteRequestModal({
  data: requestData,
}: {
  data: DataType[ModalType.ADMIN_DELETE_REQUEST];
}) {
  const { data: regions } = api.org.all.useQuery({
    orgTypes: ["region"],
  });
  const router = useRouter();
  const [status, setStatus] = useState<"approving" | "rejecting" | "idle">(
    "idle",
  );
  const { data: request } = api.request.byId.useQuery({ id: requestData.id });

  const utils = api.useUtils();

  const onReject = async () => {
    setStatus("rejecting");
    try {
      await vanillaApi.request.rejectSubmission.mutate({
        id: requestData.id,
      });
      void utils.request.invalidate();
      router.refresh();
      toast.error("Rejected delete request");
      closeModal();
    } catch (error) {
      if (error instanceof TRPCClientError) {
        toast.error(error.message);
      } else {
        toast.error("Failed to reject delete request");
      }
      console.error(error);
    } finally {
      setStatus("idle");
    }
  };

  const onDelete = async () => {
    setStatus("approving");
    if (!request) {
      toast.error("Request not found");
      setStatus("idle");
      return;
    } else if (request.eventId == undefined || request.regionId == undefined) {
      toast.error("Request is missing eventId or regionId");
      setStatus("idle");
      return;
    } else if (request.requestType !== "delete_event") {
      toast.error("Request is not a delete workout request");
      setStatus("idle");
      return;
    }

    try {
      await vanillaApi.request.validateDeleteByAdmin.mutate({
        eventId: request.eventId,
        eventName: request.eventName,
        regionId: request.regionId,
        submittedBy: request.submittedBy,
      });

      void utils.request.all.invalidate();
      router.refresh();
      toast.success("Delete request submitted");
      modalStore.setState({ modals: [] });
    } catch (error) {
      console.error(error);
      if (error instanceof TRPCClientError) {
        toast.error(error.message);
      } else {
        toast.error("Failed to submit delete request");
      }
      console.error(error);
    } finally {
      setStatus("idle");
    }
  };

  if (!request) return <div>Loading...</div>;

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className="mb-40 rounded-lg px-4 sm:px-6 lg:px-8"
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold sm:text-4xl">
            Delete Request
          </DialogTitle>
        </DialogHeader>

        <div className="my-6">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Trash className="h-12 w-12 text-destructive" />
            <div className="flex flex-col">
              <p className="text-2xl font-medium">
                {request.eventName ?? "N/A"}
              </p>
              <p className="text-sm text-muted-foreground">Event</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium">Request Details</h3>
              <div className="mt-2 rounded-md bg-muted p-3">
                <p>
                  <span className="font-medium">Location:</span>{" "}
                  {request.aoName}
                </p>
                <p>
                  <span className="font-medium">Region:</span>{" "}
                  {regions?.orgs.find((r) => r.id === request.regionId)?.name ??
                    "N/A"}
                </p>
                <p>
                  <span className="font-medium">Submitted by:</span>{" "}
                  {request.submittedBy}
                </p>
                <p>
                  <span className="font-medium">Request ID:</span> {request.id}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium">Confirmation</h3>
              <p className="mt-2 text-muted-foreground">
                Are you sure you want to approve this delete request? This
                action will permanently remove the event.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onReject}
            disabled={status === "rejecting"}
            className="bg-black text-white hover:bg-black/70 hover:text-white"
          >
            {status === "rejecting" ? (
              <div className="flex items-center gap-2">
                Rejecting... <Spinner className="size-4" />
              </div>
            ) : (
              "Reject"
            )}
          </Button>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => closeModal()}
              disabled={status === "rejecting"}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={onDelete}
              disabled={status === "approving"}
              className="bg-destructive hover:bg-destructive/90"
            >
              {status === "approving" ? (
                <div className="flex items-center gap-2">
                  Approving... <Spinner className="size-4" />
                </div>
              ) : (
                "Approve Delete"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
