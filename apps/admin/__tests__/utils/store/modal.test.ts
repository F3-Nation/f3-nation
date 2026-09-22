import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
  useOpenModal,
} from "~/utils/store/modal";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.style.pointerEvents = "";
});

describe("modal store", () => {
  beforeEach(() => {
    closeModal(undefined, "all");
  });

  it("restores page clicks after closing a modal", () => {
    vi.runOnlyPendingTimers();
    openModal(ModalType.ADMIN_USERS, { id: 1 });
    document.body.style.pointerEvents = "none";

    closeModal();

    expect(document.body.style.pointerEvents).toBe("none");
    vi.runOnlyPendingTimers();
    expect(document.body.style.pointerEvents).toBe("auto");
  });

  it("opens a modal and returns the most recently opened one", () => {
    openModal(ModalType.ADMIN_USERS, { id: 1 });
    openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
      id: 2,
      type: DeleteType.USER,
    });

    const { result } = renderHook(() => useOpenModal());
    expect(result.current?.type).toBe(ModalType.ADMIN_DELETE_CONFIRMATION);
    expect(result.current?.data).toEqual({ id: 2, type: DeleteType.USER });
  });

  it("replaces an existing modal of the same type instead of stacking it", () => {
    openModal(ModalType.ADMIN_USERS, { id: 1 });
    openModal(ModalType.ADMIN_USERS, { id: 2 });

    const { result } = renderHook(() => useOpenModal());
    expect(result.current?.data).toEqual({ id: 2 });
  });

  it("closes every modal when type is 'all'", () => {
    openModal(ModalType.ADMIN_USERS, { id: 1 });
    openModal(ModalType.ADMIN_EVENTS, { id: 2 });

    closeModal(undefined, "all");

    const { result } = renderHook(() => useOpenModal());
    expect(result.current).toBeUndefined();
  });

  it("closes only modals matching a specific type", () => {
    openModal(ModalType.ADMIN_USERS, { id: 1 });
    openModal(ModalType.ADMIN_EVENTS, { id: 2 });

    closeModal(undefined, ModalType.ADMIN_EVENTS);

    const { result } = renderHook(() => useOpenModal());
    expect(result.current?.type).toBe(ModalType.ADMIN_USERS);
  });

  it("closes just the most recently opened modal when no type is given", () => {
    openModal(ModalType.ADMIN_USERS, { id: 1 });
    openModal(ModalType.ADMIN_EVENTS, { id: 2 });

    closeModal();

    const { result } = renderHook(() => useOpenModal());
    expect(result.current?.type).toBe(ModalType.ADMIN_USERS);
  });
});

describe("organization editor stack identity", () => {
  beforeEach(() => closeModal(undefined, "all"));

  it("replaces the same organization type and restores a different type", () => {
    openModal(ModalType.ADMIN_ORG, { orgType: "sector", id: 1 });
    openModal(ModalType.ADMIN_ORG, { orgType: "area", id: 2 });
    openModal(ModalType.ADMIN_ORG, { orgType: "area", id: 3 });
    closeModal();
    const { result } = renderHook(() => useOpenModal());
    expect(result.current?.data).toEqual({ orgType: "sector", id: 1 });
  });

  it("targets a single organization type when closing", () => {
    openModal(ModalType.ADMIN_USERS, { id: 9 });
    openModal(ModalType.ADMIN_ORG, { orgType: "sector", id: 1 });
    openModal(ModalType.ADMIN_ORG, { orgType: "area", id: 2 });
    closeModal(undefined, { type: ModalType.ADMIN_ORG, orgType: "sector" });
    const { result } = renderHook(() => useOpenModal());
    expect(result.current?.data).toEqual({ orgType: "area", id: 2 });
    closeModal();
    const next = renderHook(() => useOpenModal());
    expect(next.result.current?.type).toBe(ModalType.ADMIN_USERS);
  });
});
