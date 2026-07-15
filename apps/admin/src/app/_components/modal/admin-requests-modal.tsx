"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import {
  convertHH_mmToHHmm,
  convertHHmmToHH_mm,
  requestTypeToTitle,
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

import {
  ORPCError,
  invalidateQueries,
  orpc,
  useMutation,
  useQuery,
} from "~/orpc/react";
import { useUpdateLocationForm } from "~/utils/forms";
import { uploadLogo } from "~/utils/image/upload-logo";
import type { DataType, ModalType } from "~/utils/store/modal";
import { closeModal } from "~/utils/store/modal";
import type { ActiveRequestType } from "@acme/shared/app/enums";
import { isActiveRequestType } from "@acme/shared/app/enums";

import type { AdminRequestFormProps } from "../forms/admin-request-form-props";
import { CreateAoLocationEventRequestForm } from "../forms/create-ao-location-event-request-form";
import { CreateEventRequestForm } from "../forms/create-event-request-form";
import { EditAoAndLocationRequestForm } from "../forms/edit-ao-and-location-request-form";
import { MoveAoToDifferentLocationRequestForm } from "../forms/move-ao-to-different-location-request-form";
import { MoveAoToDifferentRegionRequestForm } from "../forms/move-ao-to-different-region-request-form";
import { MoveAoToNewLocationRequestForm } from "../forms/move-ao-to-new-location-request-form";
import { MoveEventToDifferentAoRequestForm } from "../forms/move-event-to-different-ao-request-form";
import { MoveEventToNewLocationRequestForm } from "../forms/move-event-to-new-location-request-form";
import { DeleteEventRequestForm } from "../forms/delete-event-request-form";
import { DeleteAoRequestForm } from "../forms/delete-ao-request-form";

const REQUEST_FORM_MAP: Record<
  ActiveRequestType,
  React.ComponentType<AdminRequestFormProps>
> = {
  create_ao_and_location_and_event: CreateAoLocationEventRequestForm,
  create_event: CreateEventRequestForm,
  edit_event: CreateEventRequestForm,
  edit_ao_and_location: EditAoAndLocationRequestForm,
  move_ao_to_different_location: MoveAoToDifferentLocationRequestForm,
  move_ao_to_different_region: MoveAoToDifferentRegionRequestForm,
  move_ao_to_new_location: MoveAoToNewLocationRequestForm,
  move_event_to_different_ao: MoveEventToDifferentAoRequestForm,
  move_event_to_new_ao: MoveEventToDifferentAoRequestForm,
  move_event_to_new_location: MoveEventToNewLocationRequestForm,
  delete_event: DeleteEventRequestForm,
  delete_ao: DeleteAoRequestForm,
};

export default function AdminRequestsModal({
  data: requestData,
}: {
  data: DataType[ModalType.ADMIN_REQUESTS];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"approving" | "rejecting" | "idle">(
    "idle",
  );
  const [selectedAoLogoFile, setSelectedAoLogoFile] = useState<File | null>(
    null,
  );
  const [selectedAoLogoPreviewUrl, setSelectedAoLogoPreviewUrl] = useState<
    string | null
  >(null);
  const {
    data: requestResponse,
    isError,
    error,
    refetch,
  } = useQuery({
    ...orpc.request.byId.queryOptions({
      input: { id: requestData.id },
      enabled: !!requestData.id,
    }),
    // Surface load failures in the modal (error state + retry) instead of
    // throwing to an error boundary — the query client defaults throwOnError to
    // true, and the admin app has no boundary to catch it.
    throwOnError: false,
  });
  const request = requestResponse?.request;

  useEffect(() => {
    if (isError) {
      console.error(
        "admin.request.by_id_failed",
        { requestId: requestData.id },
        error,
      );
    }
  }, [isError, error, requestData.id]);
  const form = useUpdateLocationForm({
    defaultValues: { id: request?.id ?? crypto.randomUUID() },
  });

  const formId = form.watch("id");

  // The legacy "edit" request type has no dedicated form.
  const FormComponent =
    request && isActiveRequestType(request.requestType)
      ? REQUEST_FORM_MAP[request.requestType]
      : null;

  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({ input: undefined }),
  );

  const validateSubmissionByAdmin = useMutation(
    orpc.request.validateSubmissionByAdmin.mutationOptions(),
  );
  const rejectSubmissionByAdmin = useMutation(
    orpc.request.rejectSubmission.mutationOptions(),
  );

  const onSubmit = form.handleSubmit(
    async (values) => {
      try {
        setStatus("approving");
        const valuesToSubmit = { ...values };

        if (selectedAoLogoFile) {
          if (values.regionId == null || values.regionId <= -1) {
            form.setError("regionId", {
              message: "Please select a region before uploading an AO logo",
            });
            toast.error("Please select a region before uploading an AO logo");
            return;
          }

          const aoLogo = await uploadLogo({
            file: selectedAoLogoFile,
            orgId: values.regionId,
          });
          valuesToSubmit.aoLogo = aoLogo;
        }

        const submissionInput = {
          ...valuesToSubmit,
          eventStartTime: convertHH_mmToHHmm(
            valuesToSubmit.eventStartTime ?? "",
          ),
          eventEndTime: convertHH_mmToHHmm(valuesToSubmit.eventEndTime ?? ""),
        } as Parameters<typeof validateSubmissionByAdmin.mutateAsync>[0];

        await validateSubmissionByAdmin.mutateAsync(submissionInput);

        void invalidateQueries("request");
        void invalidateQueries("event");
        void invalidateQueries("location");
        router.refresh();
        toast.success("Approved update");
        closeModal();
      } catch (error) {
        // Always leave a trace: without this, a reported "approve doesn't work"
        // has nothing in the console or the error reporter to debug. (#16)
        console.error(
          "admin.request.approve_failed",
          { requestId: formId },
          error,
        );

        if (!(error instanceof ORPCError)) {
          toast.error("Something went wrong approving this update.");
          return;
        }

        if (error.message.includes("End time must be after start time")) {
          form.setError("eventEndTime", {
            message: "End time must be after start time",
          });
          // `setError` already surfaces this on the field; returning avoids an
          // unhandled promise rejection out of the un-awaited `onSubmit()`
          // onClick handler. (#274 review)
          return;
        } else if (
          error.code === "UNAUTHORIZED" ||
          error.code === "CONFLICT" ||
          error.code === "NOT_FOUND"
        ) {
          // Surface the API's explanation verbatim: UNAUTHORIZED ("ask an admin
          // of the affected org(s)"), CONFLICT ("already been approved" — a
          // racing reviewer), NOT_FOUND ("no longer exists").
          toast.error(error.message);
          if (error.code === "CONFLICT" || error.code === "NOT_FOUND") {
            // The queue is stale — refresh so the resolved row drops out.
            void invalidateQueries("request");
          }
        } else {
          toast.error("Failed to approve update");
        }
      } finally {
        setStatus("idle");
      }
    },
    (fieldErrors) => {
      // Distinguish a client-side validation failure from a server rejection:
      // surface the first invalid field so "approve doesn't work" isn't a
      // mystery. (#16)
      const firstError = Object.values(fieldErrors)[0];
      const message =
        (typeof firstError?.message === "string" && firstError.message) ||
        "Please fix the highlighted fields before approving.";
      console.error("admin.request.approve_invalid", {
        requestId: formId,
        fields: Object.keys(fieldErrors),
      });
      toast.error(message);
    },
  );

  const onReject = async () => {
    // Mirror onSubmit's try/catch/finally: without it, a failed rejection is an
    // unhandled rejection that leaves the button stuck on "Rejecting…" forever
    // with nothing toasted or logged. rejectSubmission now throws UNAUTHORIZED
    // (wrong region) and CONFLICT (already reviewed), both of which land here.
    // (#15)
    try {
      setStatus("rejecting");
      await rejectSubmissionByAdmin.mutateAsync({ id: formId });
      void invalidateQueries("request");
      router.refresh();
      toast.success("Rejected update");
      closeModal();
    } catch (error) {
      console.error(
        "admin.request.reject_failed",
        { requestId: formId },
        error,
      );
      if (
        error instanceof ORPCError &&
        (error.code === "UNAUTHORIZED" ||
          error.code === "CONFLICT" ||
          error.code === "NOT_FOUND")
      ) {
        toast.error(error.message);
        if (error.code === "CONFLICT" || error.code === "NOT_FOUND") {
          void invalidateQueries("request");
        }
      } else {
        toast.error("Failed to reject update");
      }
    } finally {
      setStatus("idle");
    }
  };

  const handleAoLogoFileChange: AdminRequestFormProps["onAoLogoFileChange"] = (
    file,
    previewUrl,
  ) => {
    setSelectedAoLogoFile(file);
    setSelectedAoLogoPreviewUrl(previewUrl);
  };

  useEffect(() => {
    if (!request) return;
    const requestMeta: Record<string, unknown> | null =
      request.meta && typeof request.meta === "object"
        ? (request.meta as Record<string, unknown>)
        : null;
    form.reset({
      id: request.id,
      meta: requestMeta,
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
    setSelectedAoLogoFile(null);
    setSelectedAoLogoPreviewUrl(null);
  }, [request, form, eventTypes]);

  useEffect(() => {
    return () => {
      if (selectedAoLogoPreviewUrl)
        URL.revokeObjectURL(selectedAoLogoPreviewUrl);
    };
  }, [selectedAoLogoPreviewUrl]);

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className="mb-40 rounded-lg px-4 sm:px-6 lg:px-8"
      >
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-destructive">
              Couldn&apos;t load this request. This may be a temporary issue.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => closeModal()}
              >
                Close
              </Button>
              <Button type="button" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          </div>
        ) : !request ? (
          <div className="flex items-center justify-center p-8">
            <Spinner className="size-8" />
          </div>
        ) : (
          <Form {...form}>
            <form className="w-[inherit] overflow-x-hidden" onSubmit={onSubmit}>
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold sm:text-4xl">
                  {requestTypeToTitle(request.requestType)}
                </DialogTitle>
              </DialogHeader>
              {FormComponent ? (
                <FormComponent
                  selectedAoLogoPreviewUrl={selectedAoLogoPreviewUrl}
                  onAoLogoFileChange={handleAoLogoFileChange}
                />
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-muted-foreground/40 p-4 text-sm text-muted-foreground">
                  This is a legacy request type with no editable form. It can’t
                  be approved here — reject it or close this dialog.
                </div>
              )}
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
                    disabled={!FormComponent}
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
        )}
      </DialogContent>
    </Dialog>
  );
}
