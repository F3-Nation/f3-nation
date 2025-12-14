import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormContext } from "react-hook-form";

import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { isTruthy } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Spinner } from "@acme/ui/spinner";
import { toast } from "@acme/ui/toast";

import { invalidateQueries, orpc, useMutation, useQuery } from "~/orpc/react";
import { closeModal } from "~/utils/store/modal";
import { DevLoadTestData } from "../forms/dev-debug-component";
import { handleSubmissionError } from "../modal/utils/handle-submission-error";

// ==================== Types ====================

interface SubmitSectionFormValues {
  id?: string;
  originalRegionId?: number;
  newRegionId?: number;
  isReview?: boolean;
}

interface MutationResult {
  status: "pending" | "rejected" | "approved";
}

interface SubmitSectionProps<T extends SubmitSectionFormValues> {
  mutationFn: (values: T) => Promise<MutationResult>;
  text: string;
  className?: string;
}

interface SubmitButtonProps {
  text: string;
  spinnerText?: string;
  isSubmitting: boolean;
  disabled?: boolean;
  variant?: "default" | "destructive" | "approve";
  className?: string;
  onClick: () => void | Promise<void>;
}

interface PermissionMessageProps {
  canEdit: boolean;
  isReview?: boolean;
}

// ==================== Custom Hooks ====================

/**
 * Hook to check if user has edit permissions for regions
 */
function useRegionPermissions(params: {
  originalRegionId?: number;
  newRegionId?: number;
}) {
  const orgIds = useMemo(
    () => [params.originalRegionId, params.newRegionId].filter(isTruthy),
    [params.originalRegionId, params.newRegionId],
  );

  const { data: canEditRegion } = useQuery(
    orpc.request.canEditRegions.queryOptions({
      input: { orgIds },
      enabled: orgIds.length > 0,
    }),
  );

  const canEdit = useMemo(
    () =>
      Array.isArray(canEditRegion) && canEditRegion.length > 0
        ? canEditRegion.every((result) => result.success)
        : false,
    [canEditRegion],
  );

  return { canEdit };
}

/**
 * Hook to handle mutation result and show appropriate feedback
 */
function useRequestStatusHandler() {
  const router = useRouter();

  const handleMutationResult = async (result: MutationResult) => {
    switch (result.status) {
      case "pending":
        toast.success(
          "Request submitted. An admin will review your submission soon.",
        );
        closeModal();
        break;

      case "rejected":
        toast.error("Failed to submit update request");
        throw new Error("Failed to submit update request");

      case "approved":
        void invalidateQueries({
          predicate: (query) => query.queryKey[0] === "request",
        });
        toast.success("Update request automatically applied");
        closeModal();
        router.refresh();
        break;

      default:
        throw new Error("Unknown mutation status");
    }
  };

  return { handleMutationResult };
}

/**
 * Hook to handle form submission with loading state and error handling
 */
function useFormSubmission<T extends SubmitSectionFormValues>(params: {
  mutationFn: (values: T) => Promise<MutationResult>;
  enableLogging?: boolean;
}) {
  const { mutateAsync: rejectSubmission } = useMutation(
    orpc.request.rejectSubmission.mutationOptions(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useFormContext<SubmitSectionFormValues>();
  const { handleMutationResult } = useRequestStatusHandler();

  const submitForm = async () => {
    setIsSubmitting(true);
    try {
      await form.handleSubmit(
        async (values) => {
          if (params.enableLogging) {
            console.log("submit section values", values);
          }
          try {
            const result = await params.mutationFn(values as T);
            await handleMutationResult(result);
          } catch (error) {
            handleSubmissionError(error);
          }
        },
        (errors) => {
          console.log("Form validation errors:", errors);
          handleSubmissionError(errors);
        },
      )();
    } finally {
      setIsSubmitting(false);
    }
  };

  const rejectForm = async () => {
    const id = form.getValues("id");
    if (!id) {
      toast.error("No request ID found");
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectSubmission({ id });
      toast.success("Request rejected");
      closeModal();
    } catch (error) {
      handleSubmissionError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, submitForm, rejectForm };
}

// ==================== Components ====================

/**
 * Reusable submit button with loading state
 */
function SubmitButton({
  text,
  spinnerText,
  isSubmitting,
  disabled,
  variant = "default",
  className,
  onClick,
}: SubmitButtonProps) {
  const getButtonStyles = () => {
    switch (variant) {
      case "approve":
        return "w-full bg-green-600 text-white hover:bg-green-600/80 sm:w-auto";
      case "destructive":
        return "w-full sm:w-auto";
      case "default":
      default:
        return "w-full bg-blue-600 text-white hover:bg-blue-600/80 sm:w-auto";
    }
  };

  return (
    <Button
      type="button"
      variant={variant === "destructive" ? "destructive" : undefined}
      className={cn(getButtonStyles(), className)}
      disabled={disabled}
      onClick={onClick}
    >
      {isSubmitting ? (
        <div className="flex items-center gap-2">
          {spinnerText ?? `${text}...`} <Spinner className="size-4" />
        </div>
      ) : (
        text
      )}
    </Button>
  );
}

/**
 * Message showing permission status
 */
function PermissionMessage({ canEdit, isReview }: PermissionMessageProps) {
  const getMessage = () => {
    if (isReview) {
      return canEdit
        ? "You can review this request since you have edit permissions for the region."
        : "You cannot approve or reject this request because you do not have edit permissions for the region.";
    }

    return canEdit
      ? "Since you can edit this region, these changes will be reflected immediately"
      : "Since you are not an editor or admin of this region, this will submit a request for review";
  };

  return (
    <div className="mb-2 text-center text-xs text-destructive">
      {getMessage()}
    </div>
  );
}

/**
 * Review action buttons (Approve/Reject)
 */
function ReviewActions({
  isSubmitting,
  canEdit,
  className,
  onSubmit,
  onReject,
}: {
  isSubmitting: boolean;
  canEdit: boolean;
  className?: string;
  onSubmit: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row">
      <SubmitButton
        text="Approve"
        spinnerText="Approving..."
        isSubmitting={isSubmitting}
        disabled={!canEdit || isSubmitting}
        variant="approve"
        className={className}
        onClick={onSubmit}
      />
      <SubmitButton
        text="Reject"
        spinnerText="Rejecting..."
        isSubmitting={isSubmitting}
        disabled={!canEdit || isSubmitting}
        variant="destructive"
        className={className}
        onClick={onReject}
      />
    </div>
  );
}

// ==================== Main Component ====================

/**
 * Submit section component with permission checking and action buttons
 */
export function SubmitSection<T extends SubmitSectionFormValues>({
  mutationFn,
  text,
  className,
}: SubmitSectionProps<T>) {
  const form = useFormContext<SubmitSectionFormValues>();
  const originalRegionId = form.watch("originalRegionId");
  const newRegionId = form.watch("newRegionId");
  const isReview = form.watch("isReview");

  const { canEdit } = useRegionPermissions({
    originalRegionId,
    newRegionId,
  });

  const { isSubmitting, submitForm, rejectForm } = useFormSubmission({
    mutationFn,
    enableLogging: !isReview,
  });

  return (
    <div className="pb-safe sticky bottom-0 -mx-[1px] mt-4 flex flex-col items-stretch justify-end gap-2 border-t border-border bg-background p-4 shadow-lg sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
      {isReview ? (
        <ReviewActions
          isSubmitting={isSubmitting}
          canEdit={canEdit}
          className={className}
          onSubmit={submitForm}
          onReject={rejectForm}
        />
      ) : (
        <SubmitButton
          text={text}
          isSubmitting={isSubmitting}
          disabled={isSubmitting}
          variant="default"
          className={className}
          onClick={submitForm}
        />
      )}

      <PermissionMessage canEdit={canEdit} isReview={isReview} />

      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => closeModal()}
      >
        Cancel
      </Button>

      {!isProductionNodeEnv && <DevLoadTestData />}
    </div>
  );
}
