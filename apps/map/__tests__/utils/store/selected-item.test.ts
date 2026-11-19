import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/orpc/react", () => ({
  getQueryData: vi.fn(),
  orpc: {
    map: { location: { eventsAndLocations: { queryKey: () => ["k"] } } },
  },
}));

import { appStore } from "~/utils/store/app";
import { modalStore, ModalType, openModal } from "~/utils/store/modal";
import {
  closePanel,
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";

const modalTypes = () => modalStore.get("modals").map((m) => m.type);

describe("closePanel", () => {
  beforeEach(() => {
    modalStore.setState({ modals: [] });
    appStore.setState({ isMobileDeviceWidth: false });
  });

  it("opens the panel on the panel layout and drops its details modal on close", () => {
    setSelectedItem({ locationId: 4, eventId: 9, showPanel: true });
    expect(selectedItemStore.get("panelLocationId")).toBe(4);
    expect(selectedItemStore.get("panelEventId")).toBe(9);
    // The modal is opened for the mobile layout; the switcher hides it here.
    expect(modalTypes()).toContain(ModalType.WORKOUT_DETAILS);

    closePanel();

    expect(selectedItemStore.get("panelLocationId")).toBeNull();
    expect(selectedItemStore.get("panelEventId")).toBeNull();
    // A later resize to the mobile layout must not bring the workout back.
    expect(modalTypes()).not.toContain(ModalType.WORKOUT_DETAILS);
  });

  it("leaves other modals open", () => {
    openModal(ModalType.SETTINGS);
    closePanel();
    expect(modalTypes()).toEqual([ModalType.SETTINGS]);
  });
});
