import type { MutableRefObject } from "react";
import { createRef } from "react";

import type { PlaceResult } from "@acme/shared/app/types";
import { ZustandStore } from "@acme/shared/common/classes";

const initialState = {
  text: "",
  placesResults: [] as PlaceResult[],
  shouldShowResults: false,
  searchBarFocused: false,
  searchBarRef:
    createRef<HTMLInputElement>() as MutableRefObject<HTMLInputElement | null>,
};

export const searchStore = new ZustandStore({
  initialState,
  persistOptions: {
    name: "search-store",
    version: 1,
    persistedKeys: [],
    getStorage: () => localStorage,
  },
});
