import { useState } from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { useFormContext } from "react-hook-form";

import { Input } from "@acme/ui/input";

import { useRuntimeConfig } from "~/utils/runtime-config";
import { DebouncedImage } from "../../debounced-image";

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
  const [imageFailed, setImageFailed] = useState(false);

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
            <div className="flex flex-col items-center gap-1">
              <DebouncedImage
                src={aoLogo}
                alt="AO Logo"
                onImageFail={() => setImageFailed(true)}
                onImageSuccess={() => setImageFailed(false)}
                width={96}
                height={96}
              />
              {imageFailed && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-destructive"
                  title="The stored logo URL couldn't be loaded"
                >
                  <ImageOff className="size-3.5" /> Unavailable
                </span>
              )}
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
