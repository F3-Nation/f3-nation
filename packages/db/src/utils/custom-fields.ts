import { customType } from "drizzle-orm/pg-core";
import z from "zod";

import { safeParseFloat } from "@acme/shared/common/functions";

const CustomNumericSchema = z.object({
  precision: z.number(),
  scale: z.number(),
});

export const customNumeric = customType<{
  data: number | null;
  config: { precision: number; scale: number };
}>({
  dataType: (config?: { precision: number; scale: number }) => {
    const { precision, scale } = CustomNumericSchema.parse(config);
    return `numeric(${precision}, ${scale})`;
  },
  fromDriver: (val) => {
    const rawValue = typeof val === "string" ? safeParseFloat(val) : null;
    return rawValue ?? null;
  },
});
