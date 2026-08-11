export interface AdminRequestFormProps {
  selectedAoLogoPreviewUrl?: string | null;
  onAoLogoFileChange?: (file: File | null, previewUrl: string | null) => void;
  /**
   * Report whether this form is blocking approval (e.g. a required check is
   * still loading, or errored). Only forms that need this call it — the
   * modal treats "never called" as "not blocking". See
   * EditLocationRequestForm for the only current user: it blocks Approve
   * until the linked-AO shared-location check resolves and (if shared) the
   * reviewer explicitly acknowledges it, mirroring the map app's own
   * EditLocationModal gate — the server enforces this too, but blocking
   * client-side means a reviewer never gets a surprise rejection.
   */
  onApprovalGateChange?: (blocked: boolean) => void;
}
