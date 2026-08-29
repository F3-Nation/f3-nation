import { Z_INDEX } from "@acme/shared/app/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { closeModal } from "~/utils/store/modal";

export const BaseModal = ({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
}) => {
  return (
    <Dialog
      open={true}
      onOpenChange={() => {
        closeModal();
      }}
    >
      <DialogContent
        style={{ zIndex: Z_INDEX.WORKOUT_DETAILS_MODAL }}
        className="mb-40 rounded-lg px-4 sm:px-6 lg:px-8"
      >
        {title && (
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold sm:text-4xl">
              {title}
            </DialogTitle>
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
};
