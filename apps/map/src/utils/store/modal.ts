import type { ReactNode } from "react";

import type { PartialBy } from "@acme/shared/common/types";
import type {
  CreateAOAndLocationAndEventType,
  CreateEventType,
  DeleteAOType,
  DeleteEventType,
  EditAOAndLocationType,
  EditEventType,
  MoveAOToDifferentLocationType,
  MoveAoToDifferentRegionType,
  MoveAOToNewLocationType,
  MoveEventToDifferentAOType,
  MoveEventToNewLocationType,
} from "@acme/validators/request-schemas";
import { ZustandStore } from "@acme/shared/common/classes";

export enum ModalType {
  LOADING = "LOADING",
  HOW_TO_JOIN = "HOW_TO_JOIN",
  USER_LOCATION_INFO = "USER_LOCATION_INFO",
  DELETE_EVENT = "DELETE_EVENT",
  DELETE_AO = "DELETE_AO",
  WORKOUT_DETAILS = "WORKOUT_DETAILS",
  INFO = "INFO",
  SETTINGS = "SETTINGS",
  ADMIN_USERS = "ADMIN_USERS",
  ADMIN_EVENTS = "ADMIN_EVENTS",
  ADMIN_LOCATIONS = "ADMIN_LOCATIONS",
  ADMIN_NATIONS = "ADMIN_NATIONS",
  ADMIN_SECTORS = "ADMIN_SECTORS",
  ADMIN_AREAS = "ADMIN_AREAS",
  ADMIN_REGIONS = "ADMIN_REGIONS",
  ADMIN_AOS = "ADMIN_AOS",
  ADMIN_API_KEYS = "ADMIN_API_KEYS",
  ADMIN_EVENT_TYPES = "ADMIN_EVENT_TYPES",
  ADMIN_DELETE_CONFIRMATION = "ADMIN_DELETE_CONFIRMATION",
  DELETE_CONFIRMATION = "DELETE_CONFIRMATION",
  QR_CODE = "QR_CODE",
  ABOUT_MAP = "ABOUT_MAP",
  MAP_HELP = "MAP_HELP",
  FULL_IMAGE = "FULL_IMAGE",
  SIGN_IN = "SIGN_IN",
  EDIT_MODE_INFO = "EDIT_MODE_INFO",
  EDIT_AO_AND_LOCATION = "AO_EDIT",
  EDIT_EVENT = "EVENT_EDIT",
  CREATE_EVENT = "CREATE_EVENT",
  CREATE_AO_AND_LOCATION_AND_EVENT = "CREATE_LOCATION_AND_EVENT",
  MOVE_AO_TO_NEW_LOCATION = "MOVE_AO_TO_NEW_LOCATION",
  MOVE_EVENT_TO_NEW_LOCATION = "MOVE_EVENT_TO_NEW_LOCATION",
  MOVE_AO_TO_DIFFERENT_LOCATION = "MOVE_AO_TO_DIFFERENT_LOCATION",
  MOVE_AO_TO_DIFFERENT_REGION = "MOVE_AO_TO_DIFFERENT_REGION",
  MOVE_EVENT_TO_DIFFERENT_AO = "MOVE_EVENT_TO_DIFFERENT_AO",
}
export enum DeleteType {
  USER = "USER",
  AREA = "AREA",
  LOCATION = "LOCATION",
  AO = "AO",
  EVENT = "EVENT",
  EVENT_TYPE = "EVENT_TYPE",
  REGION = "REGION",
  SECTOR = "SECTOR",
  NATION = "NATION",
}

export const eventDefaults = {
  newEventId: -1,
  workoutName: "",
  startTime: "0530",
  endTime: "0615",
  dayOfWeek: null,
  eventTypeIds: [1],
  eventDescription: "",
  newAoId: null,
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
  newRegionId: null,
  regionWebsite: "",
};

export interface DataType {
  [ModalType.LOADING]: null;
  [ModalType.HOW_TO_JOIN]: { content?: ReactNode };
  [ModalType.EDIT_AO_AND_LOCATION]: PartialBy<
    EditAOAndLocationType,
    | "locationLat"
    | "locationLng"
    | "originalRegionId"
    | "originalAoId"
    | "originalLocationId"
    | "submittedBy"
  >;
  [ModalType.EDIT_EVENT]: PartialBy<EditEventType, "submittedBy">;
  [ModalType.CREATE_EVENT]: PartialBy<
    CreateEventType,
    "originalLocationId" | "submittedBy"
  >;
  [ModalType.CREATE_AO_AND_LOCATION_AND_EVENT]: PartialBy<
    CreateAOAndLocationAndEventType,
    "originalRegionId" | "submittedBy"
  >;

  [ModalType.MOVE_AO_TO_NEW_LOCATION]: PartialBy<
    MoveAOToNewLocationType,
    | "originalRegionId"
    | "originalAoId"
    | "originalLocationId"
    | "locationLat"
    | "locationLng"
    | "submittedBy"
  >;
  [ModalType.MOVE_EVENT_TO_NEW_LOCATION]: PartialBy<
    MoveEventToNewLocationType,
    | "originalRegionId"
    | "originalEventId"
    | "originalLocationId"
    | "locationLat"
    | "locationLng"
    | "submittedBy"
  >;
  [ModalType.MOVE_AO_TO_DIFFERENT_LOCATION]: PartialBy<
    MoveAOToDifferentLocationType,
    | "newLocationId"
    | "originalLocationId"
    | "originalRegionId"
    | "originalAoId"
    | "submittedBy"
  >;
  [ModalType.MOVE_AO_TO_DIFFERENT_REGION]: PartialBy<
    MoveAoToDifferentRegionType,
    "originalRegionId" | "originalAoId" | "newRegionId" | "submittedBy"
  >;
  [ModalType.MOVE_EVENT_TO_DIFFERENT_AO]: PartialBy<
    MoveEventToDifferentAOType,
    | "originalRegionId"
    | "originalAoId"
    | "originalEventId"
    | "newLocationId"
    | "newAoId"
    | "submittedBy"
  >;
  [ModalType.WORKOUT_DETAILS]: {
    locationId?: number | null;
    eventId?: number | null;
  };
  [ModalType.INFO]: null;
  [ModalType.USER_LOCATION_INFO]: null;
  [ModalType.SETTINGS]: null;
  [ModalType.ADMIN_API_KEYS]: null;
  [ModalType.ADMIN_USERS]: { id?: number | null };
  [ModalType.ADMIN_EVENTS]: { id?: number | null };
  [ModalType.ADMIN_EVENT_TYPES]: { id?: number | null };
  [ModalType.ADMIN_LOCATIONS]: { id?: number | null };
  [ModalType.ADMIN_NATIONS]: { id?: number | null };
  [ModalType.ADMIN_SECTORS]: { id?: number | null };
  [ModalType.ADMIN_AREAS]: { id?: number | null };
  [ModalType.ADMIN_REGIONS]: { id?: number | null };
  [ModalType.ADMIN_AOS]: { id?: number | null };
  [ModalType.ADMIN_DELETE_CONFIRMATION]: { id: number; type: DeleteType };
  [ModalType.DELETE_CONFIRMATION]: { type: DeleteType; onConfirm: () => void };
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
  [ModalType.DELETE_EVENT]: PartialBy<
    DeleteEventType,
    "originalRegionId" | "submittedBy"
  >;
  [ModalType.DELETE_AO]: PartialBy<
    DeleteAOType,
    "originalRegionId" | "submittedBy"
  >;
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
      ...existingModals.filter(
        // Prevent duplicate modals; when opening a modal, the loading modal is closed
        (m) => m.type !== type && m.type !== ModalType.LOADING,
      ),
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
  // Modal becomes unresponsive when closing with select menu open or similar
  // https://github.com/shadcn-ui/ui/issues/1912#issuecomment-2613189967
  setTimeout(() => {
    const body = document.querySelector("body");
    if (body) {
      body.style.pointerEvents = "auto";
    }
  }, 500);
};
