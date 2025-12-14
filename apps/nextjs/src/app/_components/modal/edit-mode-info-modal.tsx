import Link from "next/link";
import { ArrowRight, Info, LockKeyholeOpen } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { useAuth } from "~/utils/hooks/use-auth";
import { closeModal } from "~/utils/store/modal";

export function EditModeInfoModal() {
  const { session } = useAuth();
  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent>
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center space-x-2">
            <Info size={16} className="text-foreground" />
            <span>Edit Mode</span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4 text-sm">
          <p>
            Edit mode allows you to make requests to add, remove, and modify
            workouts on the map.
          </p>
          <p>Click on a workout marker to see edit options</p>
          <p>Drag markers to move workouts to new locations</p>
          <p>
            Click on the map to drop a new location marker. Click on the new
            marker to add details
          </p>
          <p>
            Be sure to submit your changes! If you are not an admin or editor
            for the region, your changes will be sent to an admin for approval.
          </p>
          <p>
            If you believe you should be an admin or editor for the region,
            please make a request below.
          </p>
          {session && (
            <div>
              <p className="text-sm font-bold text-muted-foreground">
                Signed in as
                <span className="ml-1 font-semibold text-primary">
                  {session.email}
                </span>
              </p>
              {// Keep the nullish check on roles for legacy sessions that did not have roles
              session.roles?.map((role) => (
                <p
                  key={`${role.orgId}-${role.roleName}`}
                  className="text-xs text-gray-500"
                >
                  {role.orgName} ({role.roleName})
                </p>
              ))}
            </div>
          )}
          <Link
            className="flex w-full flex-row items-center justify-center gap-2 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
            target="_blank"
            href={"https://forms.gle/8AR4JCK3txSVr1Xy7"}
          >
            <LockKeyholeOpen className="size-4" />
            <span className="text-xs">Request admin access</span>
            <ArrowRight className="size-3 text-foreground" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
