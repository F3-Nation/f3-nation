"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import {
  convertHH_mmToHHmm,
  convertHHmmToHH_mm,
} from "@acme/shared/app/functions";
import { isProd } from "@acme/shared/common/constants";
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
import type { RequestType } from "@acme/shared/app/enums";

import type { AdminRequestFormProps } from "../forms/admin-request-form-props";
import { CreateAoLocationEventRequestForm } from "../forms/create-ao-location-event-request-form";
import { CreateEventRequestForm } from "../forms/create-event-request-form";
import { EditAoAndLocationRequestForm } from "../forms/edit-ao-and-location-request-form";
import { FormDebugData } from "../forms/location-event-form";
import { MoveAoToDifferentLocationRequestForm } from "../forms/move-ao-to-different-location-request-form";
import { MoveAoToDifferentRegionRequestForm } from "../forms/move-ao-to-different-region-request-form";
import { MoveAoToNewLocationRequestForm } from "../forms/move-ao-to-new-location-request-form";
import { MoveEventToDifferentAoRequestForm } from "../forms/move-event-to-different-ao-request-form";

const REQUEST_FORM_MAP: Partial<
  Record<RequestType, React.ComponentType<AdminRequestFormProps>>
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
  const { data: requestResponse } = useQuery(
    orpc.request.byId.queryOptions({
      input: { id: requestData.id },
      enabled: !!requestData.id,
    }),
  );
  const request = requestResponse?.request;
  const form = useUpdateLocationForm({
    defaultValues: { id: request?.id ?? crypto.randomUUID() },
  });

  const formId = form.watch("id");

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
        if (!(error instanceof ORPCError)) {
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
    () => {
      toast.error("Failed to approve update");
    },
  );

  const onReject = async () => {
    setStatus("rejecting");
    await rejectSubmissionByAdmin
      .mutateAsync({
        id: formId,
      })
      .then(() => {
        void invalidateQueries("request");
        router.refresh();
        setStatus("idle");
        toast.error("Rejected update");
        closeModal();
      });
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
        {!request ? (
          <div className="flex items-center justify-center p-8">
            <Spinner className="size-8" />
          </div>
        ) : (
          <Form {...form}>
            <form className="w-[inherit] overflow-x-hidden" onSubmit={onSubmit}>
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold sm:text-4xl">
                  Edit Request
                  {!isProd && <FormDebugData />}
                </DialogTitle>
              </DialogHeader>
              {(() => {
                const FormComponent = REQUEST_FORM_MAP[request.requestType];
                if (FormComponent) {
                  return (
                    <FormComponent
                      selectedAoLogoPreviewUrl={selectedAoLogoPreviewUrl}
                      onAoLogoFileChange={handleAoLogoFileChange}
                    />
                  );
                }
              })()}
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
        )}
      </DialogContent>
    </Dialog>
  );
}
