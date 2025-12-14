import { getSession } from "next-auth/react";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import type { RequestType } from "@acme/shared/app/enums";
import { requestTypeToTitle } from "@acme/shared/app/functions";
import { toast } from "@acme/ui/toast";

import type { UpdateRequestById } from "./types";
import { queryClientUtils } from "~/trpc/react";
import { vanillaApi } from "~/trpc/vanilla";
import { mapStore } from "./store/map";
import { ModalType, openModal } from "./store/modal";

export const openRequestModal = async (params: {
  type: RequestType;
  locationId?: number | null;
  eventId?: number | null;
  aoId?: number | null;
  meta?: {
    originalRegionId?: number;
    originalAoId?: number;
    originalLocationId?: number;
    originalEventId?: number;
    newRegionId?: number;
    newAoId?: number;
    newLocationId?: number;
    newEventId?: number;
  };
  review?: {
    request: UpdateRequestById;
  };
}) => {
  const requestType = params.type;

  // Determine which modal type this request maps to
  // Immediately show loading modal for better UX
  openModal(ModalType.LOADING, undefined);

  // New location marker
  const rawUpdateLocation = mapStore.get("updateLocation");
  const updateLocation = rawUpdateLocation
    ? {
        locationLat: rawUpdateLocation.lat,
        locationLng: rawUpdateLocation.lng,
      }
    : null;

  const { currentValues, formValues } = await getFormValues(params);

  // requestTypeToTitle
  switch (requestType) {
    // Update pane 1
    case "create_ao_and_location_and_event": // New Location, AO, & Event
      // If we're not in review mode, we need to have a location marker
      if (!params.review && !updateLocation) {
        toastError(params.type, "Location not found");
        return;
      }
      openModal(ModalType.CREATE_AO_AND_LOCATION_AND_EVENT, {
        ...formValues,
        ...updateLocation, // lat & lng
        requestType,
        ...params.meta,
      });
      break;

    // Update pane 2
    case "move_ao_to_new_location": // Move existing AO here, Move AO to New Location
      openModal(ModalType.MOVE_AO_TO_NEW_LOCATION, {
        ...formValues,
        ...updateLocation,
        requestType,
        currentValues,
        ...params.meta,
      });
      break;

    // Update pane 3
    case "move_event_to_new_location": // Move existing event here, Move Workout to New Location
      openModal(ModalType.MOVE_EVENT_TO_NEW_LOCATION, {
        ...formValues,
        ...updateLocation,
        ...updateLocation,
        requestType,
        currentValues,
        ...params.meta,
      });
      break;

    case "create_event": // Add Workout to AO, New Workout
      if (!formValues.originalRegionId) {
        toastError(requestType, "Region id not found");
        return;
      }
      if (!formValues.originalAoId) {
        toastError(requestType, "AO id not found");
        return;
      }
      openModal(ModalType.CREATE_EVENT, {
        ...formValues,
        originalAoId: formValues.originalAoId,
        originalRegionId: formValues.originalRegionId,
        requestType,
      });
      break;

    case "edit_event": // edit workout details
      if (!formValues.originalRegionId) {
        toastError(requestType, "Region id not found");
        return;
      }
      if (!formValues.originalEventId) {
        toastError(requestType, "Event id not found");
        return;
      }
      openModal(ModalType.EDIT_EVENT, {
        ...formValues,
        originalEventId: formValues.originalEventId,
        originalRegionId: formValues.originalRegionId,
        requestType,
        currentValues,
      });
      break;

    case "edit_ao_and_location": // Edit AO details, Edit AO and Location
      if (!formValues.originalRegionId) {
        toastError(requestType, "Region id not found");
        return;
      }
      if (!formValues.originalAoId) {
        toastError(requestType, "AO id not found");
        return;
      }
      if (!formValues.originalLocationId) {
        toastError(requestType, "Location id not found");
        return;
      }
      openModal(ModalType.EDIT_AO_AND_LOCATION, {
        ...formValues,
        requestType,
        currentValues,
      });
      break;

    case "move_ao_to_different_region": // Move to different region
      if (!formValues.originalRegionId) {
        toastError(requestType, "Original region id not found");
        return;
      }
      if (!formValues.originalAoId) {
        toastError(requestType, "Original AO id not found");
        return;
      }
      openModal(ModalType.MOVE_AO_TO_DIFFERENT_REGION, {
        ...formValues,
        newRegionId: formValues.originalRegionId,
        requestType,
        ...params.meta,
      });
      break;

    case "move_ao_to_different_location":
      openModal(ModalType.MOVE_AO_TO_DIFFERENT_LOCATION, {
        ...formValues,
        newRegionId: formValues.originalRegionId,
        newLocationId: formValues.originalLocationId,
        requestType,
        ...params.meta,
      });
      break;

    case "move_event_to_different_ao": // Move to different AO, Move Workout to Different AO
      if (!formValues.originalRegionId) {
        toastError(requestType, "Region id not found");
        return;
      }
      if (!formValues.originalEventId) {
        toastError(requestType, "Event id not found");
        return;
      }
      if (!formValues.originalAoId) {
        toastError(requestType, "AO id not found");
        return;
      }

      openModal(ModalType.MOVE_EVENT_TO_DIFFERENT_AO, {
        ...formValues,
        requestType,
        ...params.meta,
      });
      break;

    case "delete_ao":
      if (!formValues.originalAoId) {
        toastError(requestType, "AO id not found");
        return;
      }
      openModal(ModalType.DELETE_AO, {
        ...formValues,
        requestType,
        originalAoId: formValues.originalAoId,
      });
      break;
    case "delete_event":
      if (!formValues.originalEventId) {
        toastError(requestType, "Event id not found");
        return;
      }
      openModal(ModalType.DELETE_EVENT, {
        ...formValues,
        originalEventId: formValues.originalEventId,
        requestType,
      });
      break;

    // Legacy
    case "edit":
      alert(
        "This request type is no longer supported. Please resubmit your request",
      );
      break;

    default:
      throw new Error("Not implemented");
  }
};

const openRequestModalDefaults = async () => {
  const session = await getSession();
  return {
    eventName: "",
    eventStartTime: "0530",
    eventEndTime: "0615",
    eventDayOfWeek: "monday" as const,
    eventDescription: "",
    eventTypeIds: [] as number[],

    aoName: "",
    aoLogo: null,
    aoWebsite: null,

    locationAddress: "",
    locationAddress2: "",
    locationCity: "",
    locationState: "",
    locationZip: "",
    locationCountry: "United States",
    locationDescription: "",

    regionWebsite: null,

    submittedBy: session?.email ?? undefined,
  };
};

const toastError = (requestType: RequestType, message: string) => {
  toast.error(`${requestTypeToTitle(requestType)}: ${message}`);
};

// Zod schema for the overrides related to "meta" fields
const MetaOverridesSchema = z.object({
  originalRegionId: z.number().nullish(),
  originalAoId: z.number().nullish(),
  originalLocationId: z.number().nullish(),
  originalEventId: z.number().nullish(),
  newRegionId: z.number().nullish(),
  newAoId: z.number().nullish(),
  newLocationId: z.number().nullish(),
  newEventId: z.number().nullish(),
});

const getRequestOverrides = (request: UpdateRequestById) => {
  const parsedMeta = MetaOverridesSchema.safeParse(request.meta);

  return {
    id: request.id,
    token: request.token,
    // regionId: request.regionId,
    // eventId: request.eventId,
    eventTypeIds: request.eventTypeIds ?? ([] as number[]),
    eventTag: request.eventTag,
    eventSeriesId: request.eventSeriesId,
    eventIsSeries: request.eventIsSeries,
    eventIsActive: request.eventIsActive,
    eventHighlight: request.eventHighlight,
    eventStartDate: request.eventStartDate,
    eventEndDate: request.eventEndDate,
    eventStartTime: request.eventStartTime ?? undefined,
    eventEndTime: request.eventEndTime ?? undefined,
    eventDayOfWeek: request.eventDayOfWeek ?? undefined,
    eventName: request.eventName ?? undefined,
    eventDescription: request.eventDescription ?? undefined,
    eventRecurrencePattern: request.eventRecurrencePattern,
    eventRecurrenceInterval: request.eventRecurrenceInterval,
    eventIndexWithinInterval: request.eventIndexWithinInterval,
    // eventMeta: request.eventMeta,
    eventContactEmail: request.eventContactEmail,
    locationName: request.locationName,
    locationDescription: request.locationDescription,
    locationAddress: request.locationAddress ?? "",
    locationAddress2: request.locationAddress2 ?? undefined,
    locationCity: request.locationCity ?? undefined,
    locationState: request.locationState ?? undefined,
    locationZip: request.locationZip ?? undefined,
    locationCountry: request.locationCountry ?? undefined,
    locationLat: request.locationLat ?? undefined,
    locationLng: request.locationLng ?? undefined,
    // locationId: request.locationId,
    locationContactEmail: request.locationContactEmail,
    // aoId: request.aoId,
    aoName: request.aoName ?? undefined,
    aoLogo: request.aoLogo,
    aoWebsite: request.aoWebsite,
    submittedBy: request.submittedBy,
    submitterValidated: request.submitterValidated,
    reviewedBy: request.reviewedBy,
    reviewedAt: request.reviewedAt,
    status: request.status,
    // meta: request.meta,
    // created: request.created,
    // updated: request.updated,
    // requestType: request.requestType,
    ...(parsedMeta.success
      ? {
          originalRegionId: parsedMeta.data.originalRegionId ?? undefined,
          originalAoId: parsedMeta.data.originalAoId ?? undefined,
          originalLocationId: parsedMeta.data.originalLocationId ?? undefined,
          originalEventId: parsedMeta.data.originalEventId ?? undefined,
          newRegionId: parsedMeta.data.newRegionId ?? undefined,
          newAoId: parsedMeta.data.newAoId ?? undefined,
          newLocationId: parsedMeta.data.newLocationId ?? undefined,
          newEventId: parsedMeta.data.newEventId ?? undefined,
        }
      : {}),
  };
};

const getFormValues = async (params: {
  type: RequestType;
  locationId?: number | null;
  eventId?: number | null;
  aoId?: number | null;
  review?: {
    request: UpdateRequestById;
  };
}) => {
  const req = params.review?.request
    ? getRequestOverrides(params.review?.request)
    : null;

  const modifiedLocationMarker = params.locationId
    ? mapStore.get("modifiedLocationMarkers")[params.locationId]
    : null;

  const center = mapStore.get("center");

  // If we pass a locationId try to get the location
  let loc = null;
  if (params.locationId) {
    // Try to get from queryClientUtils first
    loc = queryClientUtils.location.getLocationWorkoutData.getData({
      locationId: params.locationId,
    })?.location;
  }
  // If we don't have a location try to get it from the update request
  if (!loc && req?.originalLocationId) {
    loc = (
      await vanillaApi.location.getLocationWorkoutData.query({
        locationId: req?.originalLocationId,
      })
    ).location;
  }

  let ev = null;
  if (loc && params.eventId) {
    ev = loc.events.find((e) => e.id === params.eventId);
  }

  if (!ev && loc && req?.originalEventId && loc) {
    ev = loc.events.find((e) => e.id === req?.originalEventId);
  }

  const de = await openRequestModalDefaults();
  const cur = {
    eventTypeIds: ev?.eventTypes.map((type) => type.id) ?? [],
    eventDescription: ev?.description ?? de.eventDescription,
    eventStartTime: ev?.startTime ?? de.eventStartTime,
    eventName: ev?.name ?? de.eventName,
    eventEndTime: ev?.endTime ?? de.eventEndTime,
    eventDayOfWeek: ev?.dayOfWeek ?? de.eventDayOfWeek,

    aoName: ev?.aoName ?? de.aoName,
    aoLogo: ev?.aoLogo ?? de.aoLogo,
    aoWebsite: ev?.aoWebsite ?? de.aoWebsite,

    locationLat: modifiedLocationMarker?.lat ?? loc?.lat ?? center.lat,
    locationLng: modifiedLocationMarker?.lng ?? loc?.lon ?? center.lng,
    locationAddress: loc?.locationAddress ?? de.locationAddress,
    locationAddress2: loc?.locationAddress2 ?? de.locationAddress2,
    locationCity: loc?.locationCity ?? de.locationCity,
    locationState: loc?.locationState ?? de.locationState,
    locationZip: loc?.locationZip ?? de.locationZip,
    locationCountry: loc?.locationCountry ?? de.locationCountry,
    locationDescription: loc?.locationDescription ?? de.locationDescription,

    originalEventId: params?.eventId ?? undefined,
    originalLocationId: params?.locationId ?? undefined,
    originalAoId: params?.aoId ?? undefined,
    originalRegionId: loc?.regionId ?? undefined,

    submittedBy: de.submittedBy,
  };

  const frm = {
    id: req?.id ?? uuidv4(),
    isReview: !!req,
    submittedBy: req?.submittedBy ?? cur.submittedBy,
    badImage: false,

    eventTypeIds: req?.eventTypeIds ?? cur.eventTypeIds,
    eventDescription: req?.eventDescription ?? cur.eventDescription,
    eventStartTime: req?.eventStartTime ?? cur.eventStartTime,
    eventName: req?.eventName ?? cur.eventName,
    eventEndTime: req?.eventEndTime ?? cur.eventEndTime,
    eventDayOfWeek: req?.eventDayOfWeek ?? cur.eventDayOfWeek,

    aoName: req?.aoName ?? cur.aoName,
    aoLogo: req?.aoLogo ?? cur.aoLogo,
    aoWebsite: req?.aoWebsite ?? cur.aoWebsite,

    locationLat: req?.locationLat ?? cur.locationLat,
    locationLng: req?.locationLng ?? cur.locationLng,
    locationAddress: req?.locationAddress ?? cur.locationAddress,
    locationAddress2: req?.locationAddress2 ?? cur.locationAddress2,
    locationCity: req?.locationCity ?? cur.locationCity,
    locationState: req?.locationState ?? cur.locationState,
    locationZip: req?.locationZip ?? cur.locationZip,
    locationCountry:
      req?.locationCountry ?? cur.locationCountry ?? "United States",
    locationDescription: req?.locationDescription ?? cur.locationDescription,

    originalEventId: req?.originalEventId ?? cur.originalEventId,
    originalLocationId: req?.originalLocationId ?? cur.originalLocationId,
    originalAoId: req?.originalAoId ?? cur.originalAoId,
    originalRegionId: req?.originalRegionId ?? cur.originalRegionId,
  };

  return {
    defaults: de,
    currentValues: cur,
    formValues: frm,
  };
};
