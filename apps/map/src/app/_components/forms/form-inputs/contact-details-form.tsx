import { useFormContext } from "react-hook-form";

import { Input } from "@acme/ui/input";

import { useAuth } from "~/utils/hooks/use-auth";

interface ContactDetailsFormValues {
  submittedBy: string | null;
}
export const ContactDetailsForm = <_T extends ContactDetailsFormValues>() => {
  const form = useFormContext<ContactDetailsFormValues>();
  const { session } = useAuth();

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Contact Information:
      </h2>
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">
          Your Email
        </div>
        <Input
          {...form.register("submittedBy")}
          disabled={!!session?.email}
          placeholder="your.email@example.com"
        />
        <p className="text-xs text-muted-foreground">
          We will send you a confirmation email when your update request is
          approved.
        </p>
        <p className="text-xs text-destructive">
          {form.formState.errors.submittedBy?.message?.toString()}
        </p>
      </div>
    </>
  );
};
