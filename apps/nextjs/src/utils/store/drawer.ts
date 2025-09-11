import { SnapPoint } from "@acme/shared/app/constants";
import { ZustandStore } from "@acme/shared/common/classes";

const initialState = {
  snap: SnapPoint["pt-150px"],
};

export const drawerStore = new ZustandStore({
  initialState,
  persistOptions: {
    name: "drawer-store",
    version: 1,
    persistedKeys: [],
    getStorage: () => localStorage,
  },
});
