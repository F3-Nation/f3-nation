import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemovableListOptions<T> {
  initialItems: T[];
  /** Build the unique key used for tracking the "removing" spinner state. */
  getKey: (item: T) => string;
  /** API endpoint to DELETE from. */
  endpoint: string;
  /** Build the JSON body for the DELETE request. */
  buildDeleteBody: (item: T) => Record<string, unknown>;
  /** Filter predicate: return false for the item being removed. */
  shouldKeep: (item: T, removedItem: T) => boolean;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "destructive";
  }) => void;
  /** Toast messages for success / failure. */
  successMessage: (item: T) => { title: string; description: string };
  failureTitle: string;
}

export interface UseRemovableListReturn<T> {
  items: T[];
  removing: string | null;
  handleRemove: (item: T) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Build a composite key from org + entity id. */
export function compositeKey(orgId: number, entityId: number): string {
  return `${orgId}-${entityId}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRemovableList<T>({
  initialItems,
  getKey,
  endpoint,
  buildDeleteBody,
  shouldKeep,
  toast,
  successMessage,
  failureTitle,
}: RemovableListOptions<T>): UseRemovableListReturn<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (item: T) => {
      const key = getKey(item);
      setRemoving(key);

      try {
        const res = await fetch(endpoint, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildDeleteBody(item)),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `Failed to remove item`);
        }

        setItems((prev) => prev.filter((p) => shouldKeep(p, item)));
        toast(successMessage(item));
      } catch (err) {
        toast({
          title: failureTitle,
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setRemoving(null);
      }
    },
    [
      getKey,
      endpoint,
      buildDeleteBody,
      shouldKeep,
      toast,
      successMessage,
      failureTitle,
    ],
  );

  return { items, removing, handleRemove };
}
