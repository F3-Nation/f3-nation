import type { ReactNode } from "react";
import type { OrgType } from "@acme/shared/app/enums";

import { ZustandStore } from "@acme/shared/common/classes";

export enum ModalType {
  ADMIN_USERS = "ADMIN_USERS",
  ADMIN_MANAGE_ACCESS = "ADMIN_MANAGE_ACCESS",
  ADMIN_REQUESTS = "ADMIN_REQUESTS",
  ADMIN_EVENTS = "ADMIN_EVENTS",
  ADMIN_EVENT_INSTANCES = "ADMIN_EVENT_INSTANCES",
  ADMIN_LOCATIONS = "ADMIN_LOCATIONS",
  ADMIN_ORG = "ADMIN_ORG",
  ADMIN_POSITIONS = "ADMIN_POSITIONS",
  ADMIN_API_KEYS = "ADMIN_API_KEYS",
  ADMIN_OAUTH_CLIENTS = "ADMIN_OAUTH_CLIENTS",
  ADMIN_EVENT_TYPES = "ADMIN_EVENT_TYPES",
  ADMIN_DELETE_CONFIRMATION = "ADMIN_DELETE_CONFIRMATION",
  DELETE_CONFIRMATION = "DELETE_CONFIRMATION",
  QR_CODE = "QR_CODE",
  FULL_IMAGE = "FULL_IMAGE",
  SIGN_IN = "SIGN_IN",
}

export enum DeleteType {
  USER = "USER",
  ORG = "ORG",
  LOCATION = "LOCATION",
  EVENT = "EVENT",
  EVENT_TYPE = "EVENT_TYPE",
  POSITION = "POSITION",
  ASSIGNMENT = "ASSIGNMENT",
  EVENT_INSTANCE = "EVENT_INSTANCE",
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
  [ModalType.ADMIN_EVENT_INSTANCES]: {
    id?: number | null;
  };
  [ModalType.ADMIN_LOCATIONS]: {
    id?: number | null;
  };
  [ModalType.ADMIN_ORG]: {
    orgType: OrgType;
    id?: number | null;
  };
  [ModalType.ADMIN_POSITIONS]: {
    id?: number | null;
    defaultOrgId?: number | null;
  };
  [ModalType.ADMIN_API_KEYS]: null;
  // Edit-only — creation stays on apps/auth's CLI script (see #949), so
  // there's no "open with no clientId" case like the other admin modals.
  [ModalType.ADMIN_OAUTH_CLIENTS]: {
    clientId: string;
  };
  [ModalType.ADMIN_DELETE_CONFIRMATION]: {
    id: number;
  } & (
    | { type: DeleteType.ORG; orgType: OrgType }
    | { type: Exclude<DeleteType, DeleteType.ORG> }
  );
  [ModalType.DELETE_CONFIRMATION]: {
    type: DeleteType;
    onConfirm: () => void;
  };
  [ModalType.QR_CODE]: {
    url: string;
    fileName: string;
    title: string;
  };
  [ModalType.FULL_IMAGE]: {
    title: string;
    src: string;
    fallbackSrc: string;
    alt: string;
  };
  [ModalType.ADMIN_EVENT_TYPES]: {
    id?: number | null;
  };
  [ModalType.SIGN_IN]: {
    callbackUrl?: string;
    message?: string;
  };
}

interface Modal<T extends ModalType> {
  open: boolean;
  type: T | undefined;
  content?: ReactNode;
  data?: DataType[T];
}

const modalStore = new ZustandStore<{
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
      ...existingModals.filter(
        (m) =>
          m.type !== type ||
          (type === ModalType.ADMIN_ORG &&
            (m.data as DataType[ModalType.ADMIN_ORG] | undefined)?.orgType !==
              (data as DataType[ModalType.ADMIN_ORG] | undefined)?.orgType),
      ),
      { open: true, type, data },
    ],
  });
};

export const useOpenModal = () => {
  const modals = modalStore.use.modals();
  return modals[modals.length - 1];
};

export const closeModal = (
  open?: boolean,
  type?:
    | Exclude<ModalType, ModalType.ADMIN_ORG>
    | "all"
    | { type: ModalType.ADMIN_ORG; orgType: OrgType },
) => {
  const modals = modalStore.get("modals");
  if (type === "all") {
    modalStore.setState({ modals: [] });
  } else if (type) {
    const lessModals = modals.filter((m) =>
      typeof type === "object"
        ? m.type !== type.type ||
          (m.data as DataType[ModalType.ADMIN_ORG] | undefined)?.orgType !==
            type.orgType
        : m.type !== type,
    );
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
