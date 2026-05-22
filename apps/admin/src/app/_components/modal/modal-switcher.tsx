"use client";

import type { DataType } from "~/utils/store/modal";
import { ModalType, useOpenModal } from "~/utils/store/modal";
import AdminAOsModal from "./admin-aos-modal";
import AdminApiKeysModal from "./admin-api-keys-modal";
import AdminPositionsModal from "./admin-positions-modal";
import AdminAreasModal from "./admin-areas-modal";
import AdminDeleteModal from "./admin-delete-modal";
import AdminDeleteRequestModal from "./admin-delete-request-modal";
import AdminEventTypesModal from "./admin-event-types-modal";
import AdminLocationsModal from "./admin-locations-modal";
import AdminManageAccessModal from "./admin-manage-access-modal";
import AdminNationsModal from "./admin-nations-modal";
import AdminRegionsModal from "./admin-regions-modal";
import AdminRequestsModal from "./admin-requests-modal";
import AdminSectorsModal from "./admin-sectors-modal";
import AdminUsersModal from "./admin-users-modal";
import AdminWorkoutsModal from "./admin-workouts-modal";
import DeleteModal from "./delete-modal";
import { FullImageModal } from "./full-image-modal";
import { QRCodeModal } from "./qr-code-modal";
import SignInModal from "./sign-in-modal";

interface ModalRuntimeConfig {
  googleApiKey: string;
  isProd: boolean;
}

export const ModalSwitcher = ({
  runtimeConfig,
}: {
  runtimeConfig: ModalRuntimeConfig;
}) => {
  const modal = useOpenModal();

  if (!modal) return null;
  const { type, data } = modal;

  switch (type) {
    case ModalType.ADMIN_USERS:
      return <AdminUsersModal data={data as DataType[ModalType.ADMIN_USERS]} />;
    case ModalType.ADMIN_MANAGE_ACCESS:
      return (
        <AdminManageAccessModal
          data={data as DataType[ModalType.ADMIN_MANAGE_ACCESS]}
        />
      );
    case ModalType.ADMIN_REQUESTS:
      return (
        <AdminRequestsModal data={data as DataType[ModalType.ADMIN_REQUESTS]} />
      );
    case ModalType.ADMIN_EVENTS:
      return (
        <AdminWorkoutsModal data={data as DataType[ModalType.ADMIN_EVENTS]} />
      );
    case ModalType.ADMIN_EVENT_TYPES:
      return (
        <AdminEventTypesModal
          data={data as DataType[ModalType.ADMIN_EVENT_TYPES]}
        />
      );
    case ModalType.ADMIN_API_KEYS:
      return <AdminApiKeysModal />;
    case ModalType.ADMIN_LOCATIONS:
      return (
        <AdminLocationsModal
          googleApiKey={runtimeConfig.googleApiKey}
          isProd={runtimeConfig.isProd}
          data={data as DataType[ModalType.ADMIN_LOCATIONS]}
        />
      );
    case ModalType.ADMIN_NATIONS:
      return (
        <AdminNationsModal data={data as DataType[ModalType.ADMIN_NATIONS]} />
      );
    case ModalType.ADMIN_SECTORS:
      return (
        <AdminSectorsModal data={data as DataType[ModalType.ADMIN_SECTORS]} />
      );
    case ModalType.ADMIN_AREAS:
      return <AdminAreasModal data={data as DataType[ModalType.ADMIN_AREAS]} />;
    case ModalType.ADMIN_REGIONS:
      return (
        <AdminRegionsModal data={data as DataType[ModalType.ADMIN_REGIONS]} />
      );
    case ModalType.ADMIN_AOS:
      return (
        <AdminAOsModal
          isProd={runtimeConfig.isProd}
          data={data as DataType[ModalType.ADMIN_AOS]}
        />
      );
    case ModalType.ADMIN_POSITIONS:
      return (
        <AdminPositionsModal
          data={data as DataType[ModalType.ADMIN_POSITIONS]}
        />
      );
    case ModalType.ADMIN_DELETE_CONFIRMATION:
      return (
        <AdminDeleteModal
          data={data as DataType[ModalType.ADMIN_DELETE_CONFIRMATION]}
        />
      );
    case ModalType.DELETE_CONFIRMATION:
      return (
        <DeleteModal data={data as DataType[ModalType.DELETE_CONFIRMATION]} />
      );
    case ModalType.ADMIN_DELETE_REQUEST:
      return (
        <AdminDeleteRequestModal
          data={data as DataType[ModalType.ADMIN_DELETE_REQUEST]}
        />
      );
    case ModalType.QR_CODE:
      return <QRCodeModal data={data as DataType[ModalType.QR_CODE]} />;
    case ModalType.FULL_IMAGE:
      return <FullImageModal data={data as DataType[ModalType.FULL_IMAGE]} />;
    case ModalType.SIGN_IN:
      return <SignInModal data={data as DataType[ModalType.SIGN_IN]} />;
    default:
      console.error(`Modal type ${type} not found`);
      return null;
  }
};
