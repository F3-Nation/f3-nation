/** Client headers describe a claimed app; they never establish identity. */
export function toAuditSource(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  // Keep the output within auditSettingsSql's source grammar ([a-z0-9-]);
  // unsupported characters make it reject the context and fail the request's queries.
  // Bound caller-supplied context so oversized names do not bloat history rows.
  const source = header
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 128);
  return source.length === 0 ? null : source;
}
