import { ORPCError } from "@orpc/client";
import isObject from "lodash/isObject";
import { ZodError } from "zod";

import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";
import { toast } from "@acme/ui/toast";

export const handleSubmissionError = (error: unknown): void => {
  let errorMessage: string;

  if (error instanceof ZodError) {
    console.error("handleSubmissionError ZodError", error);
    const errorMessages = error.issues
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
  } else if (error instanceof ORPCError) {
    console.error("handleSubmissionError error is an ORPCError", error);
    errorMessage = error.message;
  } else if (error instanceof Error) {
    console.error("handleSubmissionError error is Error", error);
    errorMessage = error.message;
  } else if (isObject(error)) {
    console.error("handleSubmissionError error is object", error);
    const errorMessages = Object.entries(
      error as Record<string, { message?: string; type?: string }>,
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
  } else {
    console.error("handleSubmissionError error is not an Error", error);
    errorMessage = "Failed to submit update request";
  }

  toast.error(errorMessage);
};
