import type { ReactNode } from "react";

import { ZustandStore } from "@acme/shared/common/classes";
import type { DeleteModalData } from "@acme/ui/delete-modal";
import type { FullImageModalData } from "@acme/ui/full-image-modal";
import type { QRCodeModalData } from "@acme/ui/qr-code-modal";

export enum ModalType {
  ADMIN_USERS = "ADMIN_USERS",
  ADMIN_MANAGE_ACCESS = "ADMIN_MANAGE_ACCESS",
  ADMIN_REQUESTS = "ADMIN_REQUESTS",
  ADMIN_EVENTS = "ADMIN_EVENTS",
  ADMIN_LOCATIONS = "ADMIN_LOCATIONS",
  ADMIN_NATIONS = "ADMIN_NATIONS",
  ADMIN_SECTORS = "ADMIN_SECTORS",
  ADMIN_AREAS = "ADMIN_AREAS",
  ADMIN_REGIONS = "ADMIN_REGIONS",
  ADMIN_AOS = "ADMIN_AOS",
  ADMIN_POSITIONS = "ADMIN_POSITIONS",
  ADMIN_API_KEYS = "ADMIN_API_KEYS",
  ADMIN_EVENT_TYPES = "ADMIN_EVENT_TYPES",
  ADMIN_DELETE_CONFIRMATION = "ADMIN_DELETE_CONFIRMATION",
  DELETE_CONFIRMATION = "DELETE_CONFIRMATION",
  ADMIN_DELETE_REQUEST = "ADMIN_DELETE_REQUEST",
  QR_CODE = "QR_CODE",
  FULL_IMAGE = "FULL_IMAGE",
  SIGN_IN = "SIGN_IN",
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
  POSITION = "POSITION",
  ASSIGNMENT = "ASSIGNMENT",
}

export interface DataType {
  [ModalType.ADMIN_USERS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_MANAGE_ACCESS]: {
    userId?: number;
  } | null;
  [ModalType.ADMIN_REQUESTS]: {
    id: string;
  };
  [ModalType.ADMIN_EVENTS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_LOCATIONS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_NATIONS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_SECTORS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_AREAS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_REGIONS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_AOS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_POSITIONS]: {
    id?: number | null;
    defaultOrgId?: number | null;
  };
  [ModalType.ADMIN_API_KEYS]: null;
  [ModalType.ADMIN_DELETE_CONFIRMATION]: {
    id: number;
    type: DeleteType;
  };
  [ModalType.DELETE_CONFIRMATION]: DeleteModalData & { type: DeleteType };
  [ModalType.ADMIN_DELETE_REQUEST]: {
    id: string;
  };
  [ModalType.QR_CODE]: QRCodeModalData;
  [ModalType.FULL_IMAGE]: FullImageModalData;
  [ModalType.ADMIN_EVENT_TYPES]: {
    id?: number | null;
  };
  [ModalType.SIGN_IN]: {
    callbackUrl?: string;
  };
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
    name: "admin-modal",
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
