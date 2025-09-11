import { useMemo } from "react";

export const useOptions = <T>(
  data: T[] | undefined,
  label: (item: T) => string,
  value: (item: T) => string,
) => {
  return useMemo(() => {
    return (
      data
        ?.map((item) => ({ label: label(item), value: value(item) }))
        .sort((a, b) => a.label.localeCompare(b.label)) ?? []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute when data changes
  }, [data]);
};
