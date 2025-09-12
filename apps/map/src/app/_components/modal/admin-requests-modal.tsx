"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TRPCClientError } from "@trpc/client";
import { v4 as uuid } from "uuid";

import { Z_INDEX } from "@acme/shared/app/constants";
import {
  convertHH_mmToHHmm,
  convertHHmmToHH_mm,
} from "@acme/shared/app/functions";
import { Button } from "@acme/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
import { Form } from "@acme/ui/form";
import { Spinner } from "@acme/ui/spinner";
import { toast } from "@acme/ui/toast";

import type { DataType, ModalType } from "~/utils/store/modal";
import { api } from "~/trpc/react";
import { isProd } from "~/trpc/util";
import { useUpdateLocationForm } from "~/utils/forms";
import { closeModal } from "~/utils/store/modal";
import { FormDebugData, LocationEventForm } from "../forms/location-event-form";

export default function AdminRequestsModal({
  data: requestData,
}: {
  data: DataType[ModalType.ADMIN_REQUESTS];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"approving" | "rejecting" | "idle">(
    "idle",
  );
  const { data: request } = api.request.byId.useQuery({ id: requestData.id });
  const form = useUpdateLocationForm({
    defaultValues: { id: request?.id ?? uuid() },
  });

  const formId = form.watch("id");

  const utils = api.useUtils();
  const { data: eventTypes } = api.eventType.all.useQuery();

  const validateSubmissionByAdmin =
    api.request.validateSubmissionByAdmin.useMutation();
  const rejectSubmissionByAdmin = api.request.rejectSubmission.useMutation();

  const onSubmit = form.handleSubmit(
    async (values) => {
      try {
        setStatus("approving");
        await validateSubmissionByAdmin.mutateAsync({
          ...values,
          eventStartTime: convertHH_mmToHHmm(values.eventStartTime ?? ""),
          eventEndTime: convertHH_mmToHHmm(values.eventEndTime ?? ""),
        });
        void utils.event.invalidate();
        void utils.location.invalidate();
        void utils.request.invalidate();
        router.refresh();
        toast.success("Approved update");
        closeModal();
      } catch (error) {
        console.log(error);
        if (!(error instanceof TRPCClientError)) {
          toast.error("Failed to approve update");
          return;
        }

        if (error.message.includes("End time must be after start time")) {
          form.setError("eventEndTime", {
            message: "End time must be after start time",
          });
          throw new Error("End time must be after start time");
        } else {
          toast.error("Failed to approve update");
        }
      } finally {
        setStatus("idle");
      }
    },
    (error) => {
      toast.error("Failed to approve update");
      console.log(error);
    },
  );

  const onReject = async () => {
    setStatus("rejecting");
    console.log("rejecting");
    await rejectSubmissionByAdmin
      .mutateAsync({
        id: formId,
      })
      .then(() => {
        void utils.request.invalidate();
        router.refresh();
        setStatus("idle");
        toast.error("Rejected update");
        closeModal();
      });
  };

  useEffect(() => {
    if (!request) return;
    form.reset({
      id: request.id,
      requestType: request.requestType,
      eventId: request.eventId ?? null,
      locationId: request.locationId ?? null,
      eventName: request.eventName ?? "",
      // workoutWebsite: request.web ?? "",
      locationAddress: request.locationAddress ?? "",
      locationAddress2: request.locationAddress2 ?? "",
      locationCity: request.locationCity ?? "",
      locationState: request.locationState ?? "",
      locationZip: request.locationZip ?? "",
      locationCountry: request.locationCountry ?? "",
      locationLat: request.locationLat ?? 0,
      locationLng: request.locationLng ?? 0,
      locationDescription: request.locationDescription ?? "",
      eventStartTime: convertHHmmToHH_mm(request.eventStartTime ?? ""),
      eventEndTime: convertHHmmToHH_mm(request.eventEndTime ?? ""),
      eventDayOfWeek: request.eventDayOfWeek ?? "monday",
      eventTypeIds: request.eventTypeIds ?? [],
      eventDescription: request.eventDescription ?? "",
      regionId: request.regionId ?? null,
      aoId: request.aoId ?? null,
      aoName: request.aoName ?? "",
      aoLogo: request.aoLogo ?? "",
      aoWebsite: request.aoWebsite ?? "",
      submittedBy: request.submittedBy ?? "",
    });
  }, [request, form, eventTypes]);

  if (!request) return <div>Loading...</div>;
  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className="mb-40 rounded-lg px-4 sm:px-6 lg:px-8"
      >
        <Form {...form}>
          <form className="w-[inherit] overflow-x-hidden" onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold sm:text-4xl">
                Edit Request
                {!isProd && <FormDebugData />}
              </DialogTitle>
            </DialogHeader>
            <LocationEventForm isAdminForm={true} />
            <div className="mt-4 flex justify-between gap-2">
              <Button
                type="button"
                className="bg-foreground text-background hover:bg-foreground/80"
                onClick={() => onReject()}
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
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-primary text-white hover:bg-primary/80"
                  onClick={() => onSubmit()}
                >
                  {status === "approving" ? (
                    <div className="flex items-center gap-2">
                      Submitting... <Spinner className="size-4" />
                    </div>
                  ) : (
                    "Approve"
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
