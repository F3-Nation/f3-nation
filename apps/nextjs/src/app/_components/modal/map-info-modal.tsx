import { Info } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { closeModal } from "~/utils/store/modal";

export function MapInfoModal() {
  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent>
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center space-x-2">
            <Info size={16} className="text-foreground" />
            <span>About This Map</span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <p>
            Welcome to the F3 Nation Workout Finder! This map helps you locate
            F3 workouts worldwide or in your area. Filter by time, day, or
            workout type to find the perfect session for you.
          </p>
          <p>
            Shout out to "Tackle," -- IT Director extraordinaire -- for making
            this happen!
          </p>
          <a
            href="https://mountaindev.com"
            className="text-blue-500 hover:underline"
          >
            Support this map
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
