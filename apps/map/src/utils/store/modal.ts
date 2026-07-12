import type { ReactNode } from "react";

import type {
  DayOfWeek,
  EventCadence,
  RequestType,
} from "@acme/shared/app/enums";
import { ZustandStore } from "@acme/shared/common/classes";

import type { RouterOutputs } from "~/orpc/types";
import { mapStore } from "./map";

export enum ModalType {
  HOW_TO_JOIN = "HOW_TO_JOIN",
  USER_LOCATION_INFO = "USER_LOCATION_INFO",
  UPDATE_LOCATION = "UPDATE_LOCATION",
  WORKOUT_DETAILS = "WORKOUT_DETAILS",
  INFO = "INFO",
  SETTINGS = "SETTINGS",
  DELETE_CONFIRMATION = "DELETE_CONFIRMATION",
  QR_CODE = "QR_CODE",
  ABOUT_MAP = "ABOUT_MAP",
  MAP_HELP = "MAP_HELP",
  FULL_IMAGE = "FULL_IMAGE",
  SIGN_IN = "SIGN_IN",
  EDIT_MODE_INFO = "EDIT_MODE_INFO",
}

export enum DeleteType {
  EVENT = "EVENT",
}

export const eventDefaults = {
  eventId: -1,
  workoutName: "",
  startTime: "0530",
  endTime: "0615",
  dayOfWeek: null,
  recurrencePattern: null,
  recurrenceInterval: null,
  indexWithinInterval: null,
  eventTypeIds: [1],
  eventDescription: "",
  aoId: null,
  aoWebsite: "",
};

export const locationDefaults = {
  locationId: null,
  locationAddress: "",
  locationAddress2: "",
  locationCity: "",
  locationState: "",
  locationZip: "",
  locationCountry: "",
  locationDescription: "",
  aoName: "",
  aoLogo: "",
  regionId: null,
  regionWebsite: "",
};

export const eventAndLocationToUpdateRequest = ({
  event,
  location,
}: {
  event:
    | NonNullable<
        NonNullable<
          RouterOutputs["map"]["location"]["locationWorkout"]
        >["location"]
      >["events"][number]
    | undefined;
  location: NonNullable<
    NonNullable<RouterOutputs["map"]["location"]["locationWorkout"]>["location"]
  >;
}): Omit<DataType[ModalType.UPDATE_LOCATION], "mode" | "requestType"> => {
  const possiblyEditedLoc = mapStore.get("modifiedLocationMarkers")[
    location.id
  ];

  const lat = possiblyEditedLoc?.lat ?? location.lat;
  const lng = possiblyEditedLoc?.lng ?? location.lon;

  return {
    eventId: event?.id ?? null,
    workoutName: event?.name ?? null,
    lat,
    lng,
    startTime: event?.startTime ?? null,
    endTime: event?.endTime ?? null,
    dayOfWeek: event?.dayOfWeek ?? null,
    recurrencePattern:
      (event?.recurrencePattern as EventCadence | null | undefined) ?? null,
    recurrenceInterval: event?.recurrenceInterval ?? null,
    indexWithinInterval: event?.indexWithinInterval ?? null,
    eventTypeIds: event?.eventTypes.map((type) => type.id) ?? [],
    eventDescription: event?.description ?? null,
    locationId: location.id,
    locationAddress: location.locationAddress,
    locationAddress2: location.locationAddress2,
    locationCity: location.locationCity,
    locationState: location.locationState,
    locationZip: location.locationZip,
    locationCountry: location.locationCountry,
    locationDescription: location.locationDescription,
    regionId: location.regionId,
    regionWebsite: location.regionWebsite,
    aoId: event?.aoId ?? null,
    aoName: event?.aoName ?? null,
    aoLogo: event?.aoLogo ?? null,
    aoWebsite: event?.aoWebsite ?? null,
  };
};

export interface DataType {
  [ModalType.HOW_TO_JOIN]: {
    content?: ReactNode;
  };
  [ModalType.UPDATE_LOCATION]: {
    requestType: RequestType;
    locationId: number | null;
    eventId: number | null;
    regionId: number | null;
    regionWebsite: string | null;
    workoutName: string | null;
    aoId: number | null;
    aoLogo: string | null;
    aoName: string | null;
    aoWebsite: string | null;
    lat: number;
    lng: number;
    startTime: string | null;
    endTime: string | null;
    dayOfWeek: DayOfWeek | null;
    recurrencePattern: EventCadence | null;
    recurrenceInterval: number | null;
    indexWithinInterval: number | null;
    eventTypeIds: number[];
    eventDescription: string | null;
    locationAddress: string | null;
    locationAddress2: string | null;
    locationCity: string | null;
    locationState: string | null;
    locationZip: string | null;
    locationCountry: string | null;
    locationDescription: string | null;
  };
  [ModalType.WORKOUT_DETAILS]: {
    locationId?: number | null;
    eventId?: number | null;
  };
  [ModalType.INFO]: null;
  [ModalType.USER_LOCATION_INFO]: null;
  [ModalType.SETTINGS]: null;
  [ModalType.DELETE_CONFIRMATION]: {
    type: DeleteType;
    onConfirm: () => void;
  };
  [ModalType.QR_CODE]: {
    url: string;
    fileName: string;
    title: string;
  };
  [ModalType.ABOUT_MAP]: null;
  [ModalType.FULL_IMAGE]: {
    title: string;
    src: string;
    fallbackSrc: string;
    alt: string;
  };
  [ModalType.MAP_HELP]: null;
  [ModalType.SIGN_IN]: {
    callbackUrl?: string;
    message?: string;
  };
  [ModalType.EDIT_MODE_INFO]: null;
}

export interface Modal<T extends ModalType> {
  open: boolean;
  type: T | undefined;
  content?: ReactNode;
  data?: DataType[T];
}

export const modalStore = new ZustandStore<{
  modals: Modal<ModalType>[];
}>({
  initialState: {
    modals: [] as Modal<ModalType>[],
  },
  persistOptions: {
    name: "modal",
    version: 1,
    persistedKeys: [],
    getStorage: () => localStorage,
  },
});

export const openModal = <T extends ModalType>(type: T, data?: DataType[T]) => {
  const existingModals = modalStore.get("modals");

  modalStore.setState({
    modals: [
      ...existingModals.filter((m) => m.type !== type),
      { open: true, type, data },
    ],
  });
};

export const useOpenModal = () => {
  const modals = modalStore.use.modals();
  return modals[modals.length - 1];
};

export const closeModal = (open?: boolean, type?: ModalType | "all") => {
  const modals = modalStore.get("modals");
  if (type === "all") {
    modalStore.setState({ modals: [] });
  } else if (type) {
    const lessModals = modals.filter((m) => m.type !== type);
    modalStore.setState({
      modals: lessModals,
    });
  } else {
    const lessOneModals = modals.slice(0, -1);
    modalStore.setState({
      modals: lessOneModals,
    });
  }
  setTimeout(() => {
    const body = document.querySelector("body");
    if (body) {
      body.style.pointerEvents = "auto";
    }
  }, 500);
};
