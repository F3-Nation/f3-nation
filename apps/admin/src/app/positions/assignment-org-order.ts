import type { OrgType } from "@acme/shared/app/enums";
import { orgTypeRank } from "@acme/shared/app/org-hierarchy";

interface AssignmentOrg {
  orgType: OrgType;
  name: string;
}

export const compareAssignmentOrgs = (a: AssignmentOrg, b: AssignmentOrg) => {
  // Highest tier first; an unrecognized runtime type has rank -1 and sorts last.
  const typeOrder = orgTypeRank(b.orgType) - orgTypeRank(a.orgType);
  return typeOrder || a.name.localeCompare(b.name);
};
