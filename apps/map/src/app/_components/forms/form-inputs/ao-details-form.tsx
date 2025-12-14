import { Controller, useFormContext } from "react-hook-form";

import { Input } from "@acme/ui/input";

import { scaleAndCropImage } from "~/utils/image/scale-and-crop-image";
import { uploadLogo } from "~/utils/image/upload-logo";
import { DebouncedImage } from "../../debounced-image";

interface AODetailsFormValues {
  aoName?: string;
  aoWebsite?: string | null;
  aoLogo?: string | null;
  originalRegionId: number;
  id: string;
  badImage: boolean;
}

export const AODetailsForm = <_T extends AODetailsFormValues>() => {
  const form = useFormContext<AODetailsFormValues>();
  const formOriginalRegionId = form.watch("originalRegionId");
  const formId = form.watch("id");
  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        New AO Details:
      </h2>

      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">AO Name</div>
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

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Logo
          </div>
          <Controller
            control={form.control}
            name="aoLogo"
            render={({ field: { onChange, value } }) => {
              return (
                <div className="space-y-2">
                  <Input
                    type="file"
                    name="aoLogo"
                    accept="image/*"
                    onChange={async (e) => {
                      console.log("files", e.target.files);
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const blob640 = await scaleAndCropImage(file, 640, 640);
                      if (!blob640) return;
                      const url640 = await uploadLogo({
                        file: blob640,
                        regionId: formOriginalRegionId ?? 0,
                        requestId: formId,
                      });
                      onChange(url640);
                      const blob64 = await scaleAndCropImage(file, 64, 64);
                      if (blob64) {
                        void uploadLogo({
                          file: blob64,
                          regionId: formOriginalRegionId ?? 0,
                          requestId: formId ?? "",
                          size: 64,
                        });
                      }
                    }}
                    disabled={
                      typeof formOriginalRegionId !== "number" ||
                      formOriginalRegionId <= -1
                    }
                    className="flex-1"
                  />
                  {value && (
                    <div className="flex justify-center">
                      <DebouncedImage
                        src={value}
                        alt="AO Logo"
                        onImageFail={() => form.setValue("badImage", true)}
                        onImageSuccess={() => form.setValue("badImage", false)}
                        width={96}
                        height={96}
                      />
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>
      </div>
    </>
  );
};
