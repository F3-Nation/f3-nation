/** Client headers describe a claimed app; they never establish identity. */
export function toAuditSource(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  // Match auditSettingsSql's source grammar so caller text cannot break SET LOCAL.
  // Bound caller-supplied context so oversized names do not bloat history rows.
  const source = header
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 128);
  return source.length === 0 ? null : source;
}
