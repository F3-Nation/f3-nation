/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import gte from "lodash/gte";
import { useSession } from "next-auth/react";
import { v4 as uuid } from "uuid";

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

import type { DataType, ModalType } from "~/utils/store/modal";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import { useUpdateLocationForm } from "~/utils/forms";
import { appStore } from "~/utils/store/app";
import { closeModal } from "~/utils/store/modal";
import {
  DevLoadTestData,
  FormDebugData,
  LocationEventForm,
} from "../forms/location-event-form";

export const UpdateLocationModal = ({
  data,
}: {
  data: DataType[ModalType.UPDATE_LOCATION];
}) => {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: submitUpdateRequest } = useMutation(
    orpc.request.submitUpdateRequest.mutationOptions(),
  );

  const form = useUpdateLocationForm({
    defaultValues: {
      locationCountry: "United States",
    },
    mode: "onBlur",
  });

  const formRegionId = form.watch("regionId");
  const { data: canEditRegion } = useQuery(
    orpc.request.canEditRegions.queryOptions({
      input: { orgIds: [formRegionId] },
      enabled: !!formRegionId && formRegionId !== -1,
    }),
  );

  const { data: session } = useSession();
  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({ input: undefined }),
  );

  const onSubmit = form.handleSubmit(
    async (values) => {
      try {
        console.log("onSubmit values", values);
        setIsSubmitting(true);
        if (values.badImage && !!values.aoLogo) {
          form.setError("aoLogo", { message: "Invalid image URL" });
          throw new Error("Invalid image URL");
        }
        appStore.setState({ myEmail: values.submittedBy });

        const updateRequestData = {
          ...values,
          eventStartTime: convertHH_mmToHHmm(values.eventStartTime ?? ""),
          eventEndTime: convertHH_mmToHHmm(values.eventEndTime ?? ""),
          eventId: gte(data.eventId, 0) ? data.eventId ?? null : null,
        };

        const result = await submitUpdateRequest(updateRequestData);
        if (result.status === "pending") {
          toast.success(
            "Request submitted. An admin will review your submission soon.",
          );
        } else if (result.status === "rejected") {
          toast.error("Failed to submit update request");
          throw new Error("Failed to submit update request");
        } else if (result.status === "approved") {
          void invalidateQueries({
            predicate: () => true,
          });
          toast.success("Update request automatically applied");
          router.refresh();
        }

        closeModal();
      } catch (error) {
        console.error(error);
        if (!(error instanceof Error)) {
          toast.error("Failed to submit update request");
          return;
        }

        if (!(error instanceof ORPCError)) {
          toast.error(error.message);
          return;
        }

        if (error.message.includes("End time must be after start time")) {
          form.setError("eventEndTime", {
            message: "End time must be after start time",
          });
          toast.error("End time must be after start time");
          throw new Error("End time must be after start time");
        } else {
          toast.error("Failed to submit update request");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    (errors) => {
      // Get all error messages
      const errorMessages = Object.entries(errors as { message: string }[])
        .map(([field, error]) => {
          if (error?.message) {
            return `${field}: ${error.message}`;
          }
          return null;
        })
        .filter(Boolean);

      // Show a toast with the first error message, or a generic message if none found
      toast.error(
        <div>
          {errorMessages.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>,
      );
      console.log("Form validation errors:", errors);
    },
  );

  useEffect(() => {
    form.setValue("id", uuid());
    form.setValue("requestType", data.requestType);
    if (data.regionId != null && data.regionId !== -1) {
      form.setValue("regionId", data.regionId);
    } else {
      // @ts-expect-error -- must remove regionId from form
      form.setValue("regionId", null);
    }

    form.setValue("locationId", data.locationId ?? null);
    form.setValue("locationAddress", data.locationAddress ?? "");
    form.setValue("locationAddress2", data.locationAddress2 ?? "");
    form.setValue("locationCity", data.locationCity ?? "");
    form.setValue("locationState", data.locationState ?? "");
    form.setValue("locationZip", data.locationZip ?? "");
    form.setValue("locationCountry", data.locationCountry ?? "");
    form.setValue("locationLat", data.lat);
    form.setValue("locationLng", data.lng);
    form.setValue("locationDescription", data.locationDescription ?? "");

    form.setValue("aoId", data.aoId ?? null);
    form.setValue("aoName", data.aoName ?? "");
    form.setValue("aoLogo", data.aoLogo ?? "");
    form.setValue("aoWebsite", data.aoWebsite ?? "");

    form.setValue("eventId", data.eventId ?? null);
    form.setValue("eventName", data.workoutName ?? "");
    // startTime: convertHHmmToHH_mm(event?.startTime ?? ""),
    // endTime: convertHHmmToHH_mm(event?.endTime ?? ""),
    form.setValue("eventStartTime", convertHHmmToHH_mm(data.startTime ?? ""));
    form.setValue("eventEndTime", convertHHmmToHH_mm(data.endTime ?? ""));
    form.setValue("eventDescription", data.eventDescription ?? "");
    if (data.dayOfWeek) {
      form.setValue("eventDayOfWeek", data.dayOfWeek);
    } else {
      // @ts-expect-error -- must remove dayOfWeek from form
      form.setValue("eventDayOfWeek", null);
    }
    form.setValue("eventTypeIds", data.eventTypeIds);

    form.setValue("submittedBy", session?.email || appStore.get("myEmail"));
  }, [data, eventTypes, form, session?.email]);

  return (
    <Dialog
      open={true}
      onOpenChange={() => {
        closeModal();
      }}
    >
      <DialogContent
        style={{ zIndex: Z_INDEX.WORKOUT_DETAILS_MODAL }}
        className="mb-40 rounded-lg px-4 sm:px-6 lg:px-8"
      >
        <Form {...form}>
          {/* Need 1px padding to prevent clipping of text boxes */}
          <form
            className="w-[inherit] overflow-x-hidden p-[1px]"
            onSubmit={onSubmit}
          >
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold sm:text-4xl">
                {data.requestType === "edit"
                  ? "Edit Workout"
                  : data.requestType === "create_location"
                    ? "New Location"
                    : "New Workout"}
                {!isProd && <FormDebugData />}
              </DialogTitle>
            </DialogHeader>

            <LocationEventForm />

            <div className="mt-4 flex flex-col items-stretch justify-end gap-2">
              <Button
                type="button"
                className="bg-blue-600 text-white hover:bg-blue-600/80"
                onClick={() => onSubmit()}
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    Submitting... <Spinner className="size-4" />
                  </div>
                ) : (
                  "Save Changes"
                )}
              </Button>
              {canEditRegion?.every((result) => result.success) ? (
                <div className="mb-2 text-center text-xs text-destructive">
                  Since you can edit this region, these changes will be
                  reflected immediately
                </div>
              ) : null}

              <Button
                type="button"
                variant="outline"
                onClick={() => closeModal()}
              >
                Cancel
              </Button>
              {!isProd && <DevLoadTestData />}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
