import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { closeModal } from "~/utils/store/modal";
import { UserLocationContent } from "./user-location-content";

export default function UserLocationInfoModal() {
  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent
        style={{ zIndex: Z_INDEX.USER_LOCATION_INFO_MODAL }}
        className={cn(`w-[400px] max-w-[90%] rounded-md`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">GPS Permissions</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col justify-start space-x-2 pl-4 pr-4 text-left">
          <UserLocationContent allowInteraction={true} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
