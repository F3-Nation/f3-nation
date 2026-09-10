"use client";

import type { DataType } from "~/utils/store/modal";
import { ModalType, useOpenModal } from "~/utils/store/modal";
import AdminOrgEditModal from "./admin-org-edit-modal";
import AdminApiKeysModal from "./admin-api-keys-modal";
import AdminPositionsModal from "./admin-positions-modal";
import AdminDeleteModal from "./admin-delete-modal";
import AdminEventInstancesModal from "./admin-event-instances-modal";
import AdminEventTypesModal from "./admin-event-types-modal";
import AdminLocationsModal from "./admin-locations-modal";
import AdminManageAccessModal from "./admin-manage-access-modal";
import AdminOauthClientsModal from "./admin-oauth-clients-modal";
import AdminRequestsModal from "./admin-requests-modal";
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
    case ModalType.ADMIN_EVENT_INSTANCES:
      return (
        <AdminEventInstancesModal
          data={data as DataType[ModalType.ADMIN_EVENT_INSTANCES]}
        />
      );
    case ModalType.ADMIN_EVENT_TYPES:
      return (
        <AdminEventTypesModal
          data={data as DataType[ModalType.ADMIN_EVENT_TYPES]}
        />
      );
    case ModalType.ADMIN_API_KEYS:
      return <AdminApiKeysModal />;
    case ModalType.ADMIN_OAUTH_CLIENTS:
      return (
        <AdminOauthClientsModal
          data={data as DataType[ModalType.ADMIN_OAUTH_CLIENTS]}
        />
      );
    case ModalType.ADMIN_LOCATIONS:
      return (
        <AdminLocationsModal
          googleApiKey={runtimeConfig.googleApiKey}
          isProd={runtimeConfig.isProd}
          data={data as DataType[ModalType.ADMIN_LOCATIONS]}
        />
      );
    case ModalType.ADMIN_ORG: {
      const orgData = data as DataType[ModalType.ADMIN_ORG];
      return (
        <AdminOrgEditModal
          key={orgData.orgType}
          {...orgData}
          isProd={runtimeConfig.isProd}
        />
      );
    }
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
