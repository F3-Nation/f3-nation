import { z } from "zod";
import type { OrgType } from "@acme/shared/app/enums";
import { TestId } from "@acme/shared/common/enums";
import { NationInsertSchema, SectorInsertSchema } from "@acme/validators";

interface OrgEditorConfig {
  parentType: OrgType | null;
  parentPlaceholder?: string;
  parentControl?: "select" | "combobox";
  parentTestId?: TestId;
  defaultName: string;
  retainLogo: boolean;
  logoPosition?: "afterParent" | "afterStatus";
  locationDescription?: boolean;
  compactLayout?: boolean;
  validationToast?: boolean;
  submitErrorToast?: boolean;
  rawErrorMessage?: boolean;
  fixedUpdateSuccess?: boolean;
  awaitInvalidation?: boolean;
  defaultMetaNull?: boolean;
  retainLoadedFields?: boolean;
  deactivate?: "active" | "existing";
  devFakeData?: boolean;
}

// Preserve presentation and submission exceptions at the configuration boundary.
export const orgEditorConfig: Record<OrgType, OrgEditorConfig> = {
  nation: {
    parentType: null,
    defaultName: "",
    retainLogo: false,
    compactLayout: true,
    validationToast: true,
    submitErrorToast: true,
  },
  sector: {
    parentType: "nation",
    parentPlaceholder: "Select a nation",
    defaultName: "Unknown",
    retainLogo: false,
    parentTestId: TestId.SECTOR_NATION_SELECT,
    deactivate: "existing",
  },
  area: {
    parentType: "sector",
    parentPlaceholder: "Select a sector",
    defaultName: "",
    retainLogo: true,
    deactivate: "existing",
  },
  region: {
    parentType: "area",
    parentPlaceholder: "Select an area",
    defaultName: "",
    retainLogo: true,
    logoPosition: "afterParent",
    locationDescription: true,
    validationToast: true,
    deactivate: "existing",
    awaitInvalidation: true,
  },
  ao: {
    parentType: "region",
    parentPlaceholder: "Select a region",
    parentControl: "combobox",
    defaultName: "",
    retainLogo: true,
    logoPosition: "afterStatus",
    validationToast: true,
    rawErrorMessage: true,
    fixedUpdateSuccess: true,
    defaultMetaNull: true,
    retainLoadedFields: true,
    deactivate: "active",
    devFakeData: true,
  },
};

export type EditableOrgType = keyof typeof orgEditorConfig;

/**
 * Preserve each editor's parent validation and submitted preview state.
 * Logo editors default missing badImage to false after form resets; other
 * editors leave it absent so sharing a schema does not expand their payloads.
 */
export function orgEditorSchema(config: OrgEditorConfig) {
  return SectorInsertSchema.extend({
    parentId: config.parentType
      ? SectorInsertSchema.shape.parentId
      : NationInsertSchema.shape.parentId,
    // Only logo editors supply this preview state in their submitted values.
    badImage: config.logoPosition
      ? z.boolean().default(false)
      : z.boolean().optional(),
  });
}
