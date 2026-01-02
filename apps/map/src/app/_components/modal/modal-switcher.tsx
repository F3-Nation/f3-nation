"use client";

import { useWindowSize } from "@react-hook/window-size";

import { BreakPoints } from "@acme/shared/app/constants";

import type { DataType } from "~/utils/store/modal";
import { ModalType, useOpenModal } from "~/utils/store/modal";
import { AboutMapModal } from "../map/about-map-modal";
import { MapHelpModal } from "../map/map-help-modal";
import AdminAOsModal from "./admin-aos-modal";
import AdminApiKeysModal from "./admin-api-keys-modal";
import AdminAreasModal from "./admin-areas-modal";
import AdminDeleteModal from "./admin-delete-modal";
import AdminDeleteRequestModal from "./admin-delete-request-modal";
import AdminEventTypesModal from "./admin-event-types-modal";
import AdminGrantAccessModal from "./admin-grant-access-modal";
import AdminLocationsModal from "./admin-locations-modal";
import AdminNationsModal from "./admin-nations-modal";
import AdminRegionsModal from "./admin-regions-modal";
import AdminRequestsModal from "./admin-requests-modal";
import AdminSectorsModal from "./admin-sectors-modal";
import AdminUsersModal from "./admin-users-modal";
import AdminWorkoutsModal from "./admin-workouts-modal";
import DeleteModal from "./delete-modal";
import { EditModeInfoModal } from "./edit-mode-info-modal";
import { FullImageModal } from "./full-image-modal";
import HowToJoinModal from "./how-to-join-modal";
import { MapInfoModal } from "./map-info-modal";
import { QRCodeModal } from "./qr-code-modal";
import SettingsModal from "./settings-modal";
import SignInModal from "./sign-in-modal";
import { UpdateLocationModal } from "./update-location-modal";
import UserLocationInfoModal from "./user-location-info-modal";
import { WorkoutDetailsModal } from "./workout-details-modal";

export const ModalSwitcher = () => {
  const modal = useOpenModal();
  const [width] = useWindowSize();

  if (!modal) return null;
  const { type, data } = modal;

  switch (type) {
    case ModalType.HOW_TO_JOIN:
      return <HowToJoinModal data={data as DataType[ModalType.HOW_TO_JOIN]} />;
    case ModalType.USER_LOCATION_INFO:
      return <UserLocationInfoModal />;
    case ModalType.UPDATE_LOCATION:
      return (
        <UpdateLocationModal
          data={data as DataType[ModalType.UPDATE_LOCATION]}
        />
      );
    case ModalType.WORKOUT_DETAILS:
      // Hide on desktop
      return width >= Number(BreakPoints.LG) ? null : (
        <WorkoutDetailsModal
          data={data as DataType[ModalType.WORKOUT_DETAILS]}
        />
      );
    case ModalType.INFO:
      return <MapInfoModal />;
    case ModalType.SETTINGS:
      return <SettingsModal />;
    case ModalType.ADMIN_USERS:
      return <AdminUsersModal data={data as DataType[ModalType.ADMIN_USERS]} />;
    case ModalType.ADMIN_GRANT_ACCESS:
      return (
        <AdminGrantAccessModal
          data={data as DataType[ModalType.ADMIN_GRANT_ACCESS]}
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
      return <AdminAOsModal data={data as DataType[ModalType.ADMIN_AOS]} />;
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
    case ModalType.ABOUT_MAP:
      return <AboutMapModal />;
    case ModalType.FULL_IMAGE:
      return <FullImageModal data={data as DataType[ModalType.FULL_IMAGE]} />;
    case ModalType.MAP_HELP:
      return <MapHelpModal />;
    case ModalType.SIGN_IN:
      return <SignInModal data={data as DataType[ModalType.SIGN_IN]} />;
    case ModalType.EDIT_MODE_INFO:
      return <EditModeInfoModal />;
    default:
      console.error(`Modal type ${type} not found`);
      return null;
  }
};
