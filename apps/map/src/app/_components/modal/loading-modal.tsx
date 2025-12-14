import { Z_INDEX } from "@acme/shared/app/constants";
import { Dialog, DialogContent } from "@acme/ui/dialog";
import { Loader } from "@acme/ui/loader";

import { closeModal } from "~/utils/store/modal";

/**
 * Loading placeholder modal shown while modal data is being prepared
 * Single Responsibility: Display loading state for modals
 */
export function LoadingModal() {
  return (
    <Dialog
      open={true}
      onOpenChange={() => {
        closeModal();
      }}
    >
      <DialogContent
        style={{ zIndex: Z_INDEX.LOADING_MODAL }}
        className="w-min rounded-lg px-4 sm:px-6 md:w-min lg:px-8"
      >
        <div className="flex items-center justify-center p-8">
          <div className="flex flex-col items-center gap-4">
            <Loader className="size-12" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
