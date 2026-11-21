import { FormDescription } from "@acme/ui/form";

const ACCOUNT_CHANGE_REQUEST_URL = "https://forms.gle/XYcE4bwh55Qzvj5T6";

/** Shown under a disabled email field: only nation admins can change emails. */
export function EmailChangeHint() {
  return (
    <FormDescription>
      Only F3 Nation admins can change an email.{" "}
      <a
        href={ACCOUNT_CHANGE_REQUEST_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Request a change
      </a>
    </FormDescription>
  );
}
