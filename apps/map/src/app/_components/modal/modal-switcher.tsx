"use client";

import { useWindowSize } from "@react-hook/window-size";

import { BreakPoints } from "@acme/shared/app/constants";
import DeleteModal from "@acme/ui/delete-modal";
import { FullImageModal } from "@acme/ui/full-image-modal";
import { QRCodeModal } from "@acme/ui/qr-code-modal";
import SignInModal from "@acme/ui/sign-in-modal";

import type { DataType } from "~/utils/store/modal";
import { AuthContent } from "~/app/auth/components/auth-components";
import { closeModal, ModalType, useOpenModal } from "~/utils/store/modal";
import { AboutMapModal } from "../map/about-map-modal";
import { MapHelpModal } from "../map/map-help-modal";
import { EditModeInfoModal } from "./edit-mode-info-modal";
import HowToJoinModal from "./how-to-join-modal";
import { MapInfoModal } from "./map-info-modal";
import SettingsModal from "./settings-modal";
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
      return width >= Number(BreakPoints.LG) ? null : (
        <WorkoutDetailsModal
          data={data as DataType[ModalType.WORKOUT_DETAILS]}
        />
      );
    case ModalType.INFO:
      return <MapInfoModal />;
    case ModalType.SETTINGS:
      return <SettingsModal />;
    case ModalType.DELETE_CONFIRMATION:
      return (
        <DeleteModal
          data={data as DataType[ModalType.DELETE_CONFIRMATION]}
          onClose={() => closeModal()}
        />
      );
    case ModalType.QR_CODE:
      return (
        <QRCodeModal
          data={data as DataType[ModalType.QR_CODE]}
          onClose={() => closeModal()}
        />
      );
    case ModalType.ABOUT_MAP:
      return <AboutMapModal />;
    case ModalType.FULL_IMAGE:
      return (
        <FullImageModal
          data={data as DataType[ModalType.FULL_IMAGE]}
          onClose={() => closeModal()}
        />
      );
    case ModalType.MAP_HELP:
      return <MapHelpModal />;
    case ModalType.SIGN_IN:
      return (
        <SignInModal onClose={() => closeModal()}>
          <AuthContent
            callbackUrl={(data as DataType[ModalType.SIGN_IN]).callbackUrl}
            withWrapper={false}
          />
        </SignInModal>
      );
    case ModalType.EDIT_MODE_INFO:
      return <EditModeInfoModal />;
    default:
      console.error(`Modal type ${type} not found`);
      return null;
  }
};
