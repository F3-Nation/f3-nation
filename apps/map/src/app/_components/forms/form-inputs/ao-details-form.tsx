import Link from "next/link";
import { useFormContext } from "react-hook-form";

import { Input } from "@acme/ui/input";

import { useRuntimeConfig } from "~/utils/runtime-config";
import { DebouncedImage } from "../../debounced-image";
import { noop } from "lodash";

interface AODetailsFormValues {
  aoName?: string;
  aoWebsite?: string | null;
  aoLogo?: string | null;
  originalRegionId?: number | null;
  id: string;
}

export const AODetailsForm = <_T extends AODetailsFormValues>() => {
  const form = useFormContext<AODetailsFormValues>();
  const aoLogo = form.watch("aoLogo");

  const { adminUrl } = useRuntimeConfig();

  return (
    <>
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        New AO Details:
      </h2>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Name
          </div>
          <Input {...form.register("aoName")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoName?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Website
          </div>
          <Input {...form.register("aoWebsite")} placeholder="https://" />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoWebsite?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Logo
          </div>
          {aoLogo && (
            <div className="flex justify-center">
              <DebouncedImage
                src={aoLogo}
                alt="AO Logo"
                onImageFail={noop}
                onImageSuccess={noop}
                width={96}
                height={96}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Logo changes must be done in{" "}
            {adminUrl ? (
              <Link
                href={adminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                Admin
              </Link>
            ) : (
              "Admin"
            )}
            .
          </p>
        </div>
      </div>
    </>
  );
};
