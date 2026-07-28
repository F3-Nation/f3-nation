export interface AdminRequestFormProps {
  selectedAoLogoPreviewUrl?: string | null;
  onAoLogoFileChange?: (file: File | null, previewUrl: string | null) => void;
}
