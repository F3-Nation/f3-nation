import { Client } from "@acme/shared/common/enums";

/** Client headers describe a claimed app; they never establish identity. */
export function toAuditSource(
  header: string | null | undefined,
): string | null {
  switch (header) {
    case Client.F3_MAP:
      return "map";
    case Client.F3_ADMIN:
      return "admin";
    case Client.F3_ME:
      return "me";
    case Client.F3_REGION_PAGES:
      return "region-pages";
    case Client.F3_SLACKBOT:
      return "slackbot";
    case Client.ORPC_SSG:
      return "map-ssg";
    case Client.SCALAR_API:
      return "scalar-api";
    default:
      return null;
  }
}
