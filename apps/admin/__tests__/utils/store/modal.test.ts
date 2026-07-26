import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
  useOpenModal,
} from "~/utils/store/modal";

describe("modal store", () => {
  beforeEach(() => {
    closeModal(undefined, "all");
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
