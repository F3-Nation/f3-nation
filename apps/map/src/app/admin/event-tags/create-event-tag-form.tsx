"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";

import { safeParseInt } from "@acme/shared/common/functions";
import { Button } from "@acme/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@acme/ui/form";
import { Input } from "@acme/ui/input";
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { EventTagInsertSchema } from "@acme/validators";

import { VirtualizedCombobox } from "~/app/_components/virtualized-combobox";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";

const EventTagCreateFormSchema = EventTagInsertSchema.extend({
  name: z.string().min(1, { message: "Name is required" }),
});

type EventTagCreateFormValues = z.infer<typeof EventTagCreateFormSchema>;

export function CreateEventTagForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: regions } = useQuery(
    orpc.org.accessible.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const sortedRegions = useMemo(() => {
    return regions?.orgs.sort((a, b) => {
      return a.orgType.localeCompare(b.orgType) || a.name.localeCompare(b.name);
    });
  }, [regions]);

  const form = useForm({
    schema: EventTagCreateFormSchema,
    defaultValues: {
      name: "",
      description: "",
      color: "",
      specificOrgId: undefined,
      isActive: true,
    } satisfies Partial<EventTagCreateFormValues>,
  });

  const crupdateEventTag = useMutation(
    orpc.eventTag.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("eventTag");
        toast.success("Successfully created event tag");
        form.reset({
          name: "",
          description: "",
          color: "",
          specificOrgId: undefined,
          isActive: true,
        });
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? err.message ?? "You are not authorized to create this event tag"
            : "Failed to create event tag",
        );
      },
    }),
  );

  const onSubmit = async (data: EventTagCreateFormValues) => {
    setIsSubmitting(true);
    try {
      await crupdateEventTag.mutateAsync({
        name: data.name.trim(),
        description: data.description?.trim() ?? null,
        color: data.color?.trim() ?? null,
        specificOrgId: data.specificOrgId ?? null,
        isActive: data.isActive ?? true,
      });
    } catch {
      // handled in onError
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Create event tag</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Tag name"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="specificOrgId"
            render={({ field }) => (
              <FormItem key={`region-${String(field.value ?? "new")}`}>
                <FormLabel>Region scope (optional)</FormLabel>
                <FormControl>
                  <VirtualizedCombobox
                    value={field.value?.toString()}
                    options={
                      sortedRegions?.map((org) => ({
                        value: org.id.toString(),
                        label:
                          org.orgType !== "region"
                            ? `${org.name} (${org.orgType})`
                            : org.name,
                      })) ?? []
                    }
                    searchPlaceholder="Nation-wide (no region)"
                    onSelect={(value) => {
                      if (typeof value === "string") {
                        const numberValue = safeParseInt(value);
                        if (numberValue === field.value) {
                          field.onChange(null);
                        } else {
                          field.onChange(safeParseInt(value));
                        }
                      } else {
                        field.onChange(null);
                      }
                    }}
                    isMulti={false}
                    hideClearButton
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  Leave unset for a nation-wide tag, or pick a region to scope
                  the tag to that org.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color (optional)</FormLabel>
                <FormControl>
                  <Input
                    placeholder="#336699"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description (optional)</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} rows={4} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                Creating… <Spinner className="size-4" />
              </span>
            ) : (
              "Create tag"
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}
