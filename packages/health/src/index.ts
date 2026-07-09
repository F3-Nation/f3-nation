import { z } from "zod";

export const HEALTH_CONTRACT_VERSION = "1.0.0" as const;

export const healthStatusSchema = z.enum(["ok", "degraded", "down"]);

export const healthSeveritySchema = z.enum(["critical", "warning", "info"]);

export const healthCheckSchema = z.object({
  id: z.string().min(1),
  status: healthStatusSchema,
  severity: healthSeveritySchema.default("warning"),
  latencyMs: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  contractVersion: z.string().min(1),
  status: healthStatusSchema,
  timestamp: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  checks: z.array(healthCheckSchema).min(1),
  notes: z.array(z.string()).optional(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type HealthSeverity = z.infer<typeof healthSeveritySchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
