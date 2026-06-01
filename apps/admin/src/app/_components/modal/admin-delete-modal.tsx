"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
import { toast } from "@acme/ui/toast";

import { ORPCError, invalidateQueries, orpc } from "~/orpc/react";
import type { DataType, ModalType } from "~/utils/store/modal";
import { DeleteType, closeModal } from "~/utils/store/modal";

export default function AdminDeleteModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_DELETE_CONFIRMATION];
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  let mutation: ({ id }: { id: number }) => Promise<{
    orgId?: number;
    positionId?: number;
    eventTypeId?: number;
    eventId?: number;
    locationId?: number;
    userId?: number;
  } | void>;

  switch (data.type) {
    case DeleteType.NATION:
    case DeleteType.SECTOR:
    case DeleteType.AREA:
    case DeleteType.REGION:
    case DeleteType.AO:
      mutation = orpc.org.delete.call;
      break;
    case DeleteType.EVENT:
      mutation = orpc.event.delete.call;
      break;
    case DeleteType.EVENT_TYPE:
      mutation = orpc.eventType.delete.call;
      break;
    case DeleteType.USER:
      mutation = orpc.user.delete.call;
      break;
    case DeleteType.LOCATION:
      mutation = orpc.location.delete.call;
      break;
    case DeleteType.POSITION:
      mutation = orpc.position.delete.call;
      break;
    default:
      throw new Error(`Invalid delete type: ${data.type}`);
  }

  const handleDelete = async (id: number) => {
    setIsPending(true);
    try {
      await mutation({ id });
      toast.success(
        `Successfully deactivated ${dataTypeToName(data.type).toLowerCase()}`,
      );

      // Invalidate queries and wait for completion so the table refreshes
      switch (data.type) {
        case DeleteType.NATION:
        case DeleteType.SECTOR:
        case DeleteType.AREA:
        case DeleteType.REGION:
        case DeleteType.AO:
          await invalidateQueries("org");
          await invalidateQueries("map");
          break;
        case DeleteType.EVENT:
          await invalidateQueries("event");
          await invalidateQueries("map");
          break;
        case DeleteType.EVENT_TYPE:
          await invalidateQueries("eventType");
          await invalidateQueries("map");
          break;
        case DeleteType.USER:
          await invalidateQueries("user");
          break;
        case DeleteType.LOCATION:
          await invalidateQueries("location");
          await invalidateQueries("map");
          break;
        case DeleteType.POSITION:
          await invalidateQueries("position");
          break;
        default:
          throw new Error(`Invalid deactivate type: ${data.type}`);
      }

      router.refresh();
      closeModal();
    } catch (err) {
      console.error("deactivate-modal err", err);
      if (err instanceof ORPCError) {
        toast.error(
          err?.code === "UNAUTHORIZED"
            ? `You are not authorized to deactivate this ${dataTypeToName(data.type).toLowerCase()}`
            : `Failed to deactivate ${dataTypeToName(data.type).toLowerCase()}`,
        );
      } else {
        toast.error(
          `Failed to deactivate ${dataTypeToName(data.type).toLowerCase()}`,
        );
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[400px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            Deactivate {dataTypeToName(data.type)}
          </DialogTitle>
        </DialogHeader>

        <div className="my-6 w-full px-3">
          {`Are you sure you want to deactivate this ${dataTypeToName(data.type)}?`}
        </div>
        <div className="mb-2 w-full px-2">
          <div className="flex space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => closeModal()}
              className="w-full"
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="w-full"
              onClick={() => handleDelete(data.id)}
            >
              Deactivate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const dataTypeToName = (
  dataType: DataType[ModalType.ADMIN_DELETE_CONFIRMATION]["type"],
) => {
  switch (dataType) {
    case DeleteType.NATION:
      return "Nation";
    case DeleteType.SECTOR:
      return "Sector";
    case DeleteType.AREA:
      return "Area";
    case DeleteType.REGION:
      return "Region";
    case DeleteType.AO:
      return "AO";
    case DeleteType.EVENT:
      return "Event";
    case DeleteType.EVENT_TYPE:
      return "Event Type";
    case DeleteType.USER:
      return "User";
    case DeleteType.LOCATION:
      return "Location";
    case DeleteType.POSITION:
      return "Position";
    default:
      throw new Error(`Invalid deactivate type: ${dataType}`);
  }
};
