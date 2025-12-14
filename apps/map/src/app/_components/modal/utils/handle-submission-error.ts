import { TRPCClientError } from "@trpc/client";
import isObject from "lodash/isObject";
import { ZodError } from "zod";

import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";
import { toast } from "@acme/ui/toast";

export const handleSubmissionError = (error: unknown): void => {
  console.error(error);

  let errorMessage: string;

  if (error instanceof ZodError) {
    const errorMessages = error.errors
      .map((err) => {
        if (err?.message) {
          return `${err.path.join(".")}: ${err.message}`;
        }
        return null;
      })
      .filter(Boolean);

    errorMessage =
      errorMessages.length > 0
        ? errorMessages.join(", ")
        : "Form validation failed";
  } else if (isObject(error)) {
    const errorMessages = Object.entries(
      error as { message: string; type: string }[],
    )
      .map(([key, err]) => {
        const keyWords = convertCase({ str: key, toCase: Case.TitleCase });
        if (err?.message) {
          return `${keyWords}: ${err.message}`;
        }
        return null;
      })
      .filter(Boolean);

    errorMessage =
      errorMessages.length > 0
        ? errorMessages.join(", ")
        : "Form validation failed";
  } else if (!(error instanceof Error)) {
    errorMessage = "Failed to submit update request";
  } else if (!(error instanceof TRPCClientError)) {
    errorMessage = error.message;
  } else {
    errorMessage = "Failed to submit update request";
  }

  toast.error(errorMessage);
};
