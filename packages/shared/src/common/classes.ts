import type { StoreApi, UseBoundStore } from "zustand";
import type { PersistOptions, StateStorage } from "zustand/middleware";
import pick from "lodash/pick";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { FlattenObjectKeys, GetFieldType } from "./types";
import { getValue } from "./functions";

type Write<T, U> = Omit<T, keyof U> & U;
type PersistListener<S> = (state: S) => void;

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never;

const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(
  _store: S,
) => {
  // eslint-disable-next-line prefer-const
  let store = _store as WithSelectors<typeof _store>;
  store.use = {};
  for (const k of Object.keys(store.getState())) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (store.use as any)[k] = () => store((s) => s[k as keyof typeof s]);
  }

  return store;
};

interface StorePersist<S, Ps> {
  persist: {
    setOptions: (options: Partial<PersistOptions<S, Ps>>) => void;
    clearStorage: () => void;
    rehydrate: () => Promise<void> | void;
    hasHydrated: () => boolean;
    onHydrate: (fn: PersistListener<S>) => () => void;
    onFinishHydration: (fn: PersistListener<S>) => () => void;
    getOptions: () => Partial<PersistOptions<S, Ps>>;
  };
}

const ZUSTAND_STORE_LOGS = false;
/**
 * A note on useBoundStore: if you don't provide a selector, it will update on every state change
 * (even if the value didn't change)
 */
export class ZustandStore<T extends Record<string, unknown>> {
  useBoundStoreBase: UseBoundStore<Write<StoreApi<T>, StorePersist<T, T>>>;
  useBoundStore: WithSelectors<UseBoundStore<StoreApi<T>>>;
  use: WithSelectors<UseBoundStore<StoreApi<T>>>["use"];
  name: string;
  hasHydrated = false;
  constructor(props: {
    initialState: T;
    persistOptions: {
      name: string;
      persistedKeys?: (keyof T)[];
      version: number;
      getStorage: () => StateStorage;
      onRehydrateStorage?: (state: T | undefined) => void;
    };
  }) {
    this.name = props.persistOptions.name;
    this.useBoundStoreBase = create<T>()(
      persist(() => props.initialState, {
        name: props.persistOptions.name,
        storage: createJSONStorage<T>(props.persistOptions.getStorage),
        version: props.persistOptions.version ?? 1,
        migrate: (state) => {
          ZUSTAND_STORE_LOGS && console.log("migrating state", state);
          return Promise.resolve(props.initialState);
        },
        partialize: (state) =>
          pick(state, props.persistOptions.persistedKeys ?? []) as T,
        // This will hold the app at the splash screen until the hydration is done.
        onRehydrateStorage: (state) => {
          ZUSTAND_STORE_LOGS &&
            console.log(`${this.name} store hydration starts`, state);
          return (hydratedState, error) => {
            if (error) {
              ZUSTAND_STORE_LOGS &&
                console.log(`${this.name} store hydration error`, error);
            } else {
              props.persistOptions.onRehydrateStorage?.(hydratedState);
              const hydratedStateString = JSON.stringify(hydratedState);
              this.hasHydrated = true;
              ZUSTAND_STORE_LOGS &&
                console.log(
                  `${this.name} store hydration finished`,
                  hydratedStateString.length > 40
                    ? hydratedStateString.slice(0, 40)
                    : hydratedStateString,
                );
            }
          };
        },
      }),
    );
    this.useBoundStore = createSelectors(this.useBoundStoreBase);
    this.use = this.useBoundStore.use;
  }

  get<U extends FlattenObjectKeys<T>>(key: U): GetFieldType<T, U> {
    return getValue(this.useBoundStore.getState(), key);
  }

  getState() {
    return this.useBoundStore.getState();
  }

  /**
   * @deprecated Use native setState instead. set used to have an issue where
   * it would cause excessive rerenders due to whole-state cloneDeep
   */
  set<U extends keyof T, V extends GetFieldType<T, U>>(key: U, value: V) {
    // Somehow setState does magic to prevent other objects from being marked as updated
    const partialState = { [key]: value } as unknown as Partial<T>;
    this.useBoundStore.setState(partialState);
  }

  /**
   * This function does some magic to prevent other top-level keys from being updated
   * Also will not update unchanged objects in the updated keys of the Partial object
   * eg i={a:{b:1},c:2} -> {c:3,...i} will not update a.
   * This is because that object reference is the same
   */
  setState(...fn: Parameters<typeof this.useBoundStore.setState>) {
    this.useBoundStore.setState(...fn);
  }

  // This is deprecated, use native setState instead. update used to have an issue
  // where it would cause excessive rerenders due to whole-state cloneDeep
  /**
   * @deprecated Use setState instead
   */
  update(...fn: Parameters<typeof this.useBoundStore.setState>) {
    this.useBoundStore.setState(...fn);
  }
}
