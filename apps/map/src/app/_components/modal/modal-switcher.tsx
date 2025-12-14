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
import AdminEventTypesModal from "./admin-event-types-modal";
import AdminLocationsModal from "./admin-locations-modal";
import AdminNationsModal from "./admin-nations-modal";
import AdminRegionsModal from "./admin-regions-modal";
import AdminSectorsModal from "./admin-sectors-modal";
import AdminUsersModal from "./admin-users-modal";
import AdminWorkoutsModal from "./admin-workouts-modal";
import DeleteConfirmationModal from "./delete-confirmation-modal";
import { EditModeInfoModal } from "./edit-mode-info-modal";
import { FullImageModal } from "./full-image-modal";
import HowToJoinModal from "./how-to-join-modal";
import { LoadingModal } from "./loading-modal";
import { MapInfoModal } from "./map-info-modal";
import { QRCodeModal } from "./qr-code-modal";
import SettingsModal from "./settings-modal";
import SignInModal from "./sign-in-modal";
import { CreateAOAndLocationAndEventModal } from "./update/create-ao-and-location-and-event-modal";
import { CreateEventModal } from "./update/create-event-modal";
import { DeleteAoModal } from "./update/delete-ao-modal";
import { DeleteEventModal } from "./update/delete-event-modal";
import { EditAoAndLocationModal } from "./update/edit-ao-and-location-modal";
import { EditEventModal } from "./update/edit-event-modal";
import { MoveAOToDifferentLocationModal } from "./update/move-ao-to-different-location-modal";
import { MoveAOToDifferentRegionModal } from "./update/move-ao-to-different-region-modal";
import { MoveAOToNewLocationModal } from "./update/move-ao-to-new-location-modal";
import { MoveEventToDifferentAoModal } from "./update/move-event-to-different-ao-modal";
import { MoveEventToNewLocationModal } from "./update/move-event-to-new-location-modal";
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
    case ModalType.EDIT_AO_AND_LOCATION:
      return (
        <EditAoAndLocationModal
          data={data as DataType[ModalType.EDIT_AO_AND_LOCATION]}
        />
      );
    case ModalType.EDIT_EVENT:
      return <EditEventModal data={data as DataType[ModalType.EDIT_EVENT]} />;
    case ModalType.CREATE_EVENT:
      return (
        <CreateEventModal data={data as DataType[ModalType.CREATE_EVENT]} />
      );
    case ModalType.CREATE_AO_AND_LOCATION_AND_EVENT:
      return (
        <CreateAOAndLocationAndEventModal
          data={data as DataType[ModalType.CREATE_AO_AND_LOCATION_AND_EVENT]}
        />
      );
    case ModalType.MOVE_AO_TO_NEW_LOCATION:
      return (
        <MoveAOToNewLocationModal
          data={data as DataType[ModalType.MOVE_AO_TO_NEW_LOCATION]}
        />
      );
    case ModalType.MOVE_EVENT_TO_NEW_LOCATION:
      return (
        <MoveEventToNewLocationModal
          data={data as DataType[ModalType.MOVE_EVENT_TO_NEW_LOCATION]}
        />
      );
    case ModalType.MOVE_AO_TO_DIFFERENT_LOCATION:
      return (
        <MoveAOToDifferentLocationModal
          data={data as DataType[ModalType.MOVE_AO_TO_DIFFERENT_LOCATION]}
        />
      );
    case ModalType.MOVE_AO_TO_DIFFERENT_REGION:
      return (
        <MoveAOToDifferentRegionModal
          data={data as DataType[ModalType.MOVE_AO_TO_DIFFERENT_REGION]}
        />
      );
    case ModalType.MOVE_EVENT_TO_DIFFERENT_AO:
      return (
        <MoveEventToDifferentAoModal
          data={data as DataType[ModalType.MOVE_EVENT_TO_DIFFERENT_AO]}
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
        <DeleteConfirmationModal
          data={data as DataType[ModalType.DELETE_CONFIRMATION]}
        />
      );
    case ModalType.DELETE_EVENT:
      return (
        <DeleteEventModal data={data as DataType[ModalType.DELETE_EVENT]} />
      );
    case ModalType.DELETE_AO:
      return <DeleteAoModal data={data as DataType[ModalType.DELETE_AO]} />;
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
    case ModalType.LOADING:
      return <LoadingModal />;
    default:
      console.error(`Modal type ${type} not found`);
      return null;
  }
};
