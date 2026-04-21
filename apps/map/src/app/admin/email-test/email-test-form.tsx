"use client";

import { useState } from "react";
import { z } from "zod";

import { Templates } from "@acme/mail/templates";
import { Button } from "@acme/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@acme/ui/form";
import { Input } from "@acme/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Switch } from "@acme/ui/switch";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import { orpc, useMutation } from "~/orpc/react";

interface TemplateField {
  name: string;
  label: string;
  type: "text" | "email" | "textarea" | "boolean";
  default: string | boolean;
}

interface TemplateConfig {
  name: string;
  description: string;
  fields: TemplateField[];
}

const templateConfigs: Record<Templates, TemplateConfig> = {
  [Templates.feedbackForm]: {
    name: "Feedback Form",
    description: "Email sent when a user submits feedback",
    fields: [
      { name: "type", label: "Type", type: "text", default: "Bug Report" },
      {
        name: "email",
        label: "Email",
        type: "email",
        default: "user@example.com",
      },
      {
        name: "subject",
        label: "Subject",
        type: "text",
        default: "Test Subject",
      },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        default: "This is a test description for the feedback form.",
      },
    ],
  },
  [Templates.mapChangeRequest]: {
    name: "Map Change Request",
    description: "Email sent when a map change request is submitted",
    fields: [
      {
        name: "regionName",
        label: "Region Name",
        type: "text",
        default: "Test Region",
      },
      {
        name: "workoutName",
        label: "Workout Name",
        type: "text",
        default: "The Murph",
      },
      {
        name: "requestType",
        label: "Request Type",
        type: "text",
        default: "Update",
      },
      {
        name: "submittedBy",
        label: "Submitted By",
        type: "text",
        default: "Test User",
      },
      { name: "requestsUrl", label: "Requests URL", type: "text", default: "" },
      {
        name: "noAdminsNotice",
        label: "No Admins Notice",
        type: "boolean",
        default: false,
      },
      {
        name: "recipientRole",
        label: "Recipient Role",
        type: "text",
        default: "admin",
      },
      {
        name: "recipientOrg",
        label: "Recipient Org",
        type: "text",
        default: "Test Region",
      },
    ],
  },
};

const formSchema = z.object({
  template: z.nativeEnum(Templates),
  to: z.string().email("Please enter a valid email address"),
  data: z.record(z.unknown()),
});

export const EmailTestForm = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<Templates>(
    Templates.mapChangeRequest,
  );
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const sendTestMutation = useMutation(
    orpc.mail.sendTest.mutationOptions({
      onSuccess: (data) => {
        if (data.success) {
          toast.success(data.message);
        } else {
          toast.error(data.message);
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const previewMutation = useMutation(
    orpc.mail.preview.mutationOptions({
      onSuccess: (data) => {
        setPreviewHtml(data.html);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const templateConfig = templateConfigs[selectedTemplate];

  // Build default values from template config
  const getDefaultValues = (template: Templates) => {
    const config = templateConfigs[template];
    const data: Record<string, unknown> = {};
    config.fields.forEach((field) => {
      data[field.name] = field.default;
    });
    return {
      template,
      to: "",
      data,
    };
  };

  const form = useForm({
    schema: formSchema,
    defaultValues: getDefaultValues(selectedTemplate),
  });

  const handleTemplateChange = (value: string) => {
    const template = value as Templates;
    setSelectedTemplate(template);
    setPreviewHtml(null);
    form.reset(getDefaultValues(template));
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    sendTestMutation.mutate({
      template: values.template,
      to: values.to,
      data: values.data,
    });
  };

  const handlePreview = () => {
    const values = form.getValues();
    previewMutation.mutate({
      template: values.template,
      data: values.data,
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Send Test Email</CardTitle>
          <CardDescription>
            Select a template, fill in the fields, and send a test email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="template"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        handleTemplateChange(value);
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a template" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.values(Templates).map((template) => (
                          <SelectItem key={template} value={template}>
                            {templateConfigs[template].name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {templateConfig.description}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Send To</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="recipient@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      The email address to send the test to.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4">
                <h4 className="mb-3 text-sm font-medium">Template Fields</h4>
                <div className="space-y-3">
                  {templateConfig.fields.map((fieldConfig) => (
                    <FormField
                      key={fieldConfig.name}
                      control={form.control}
                      name={`data.${fieldConfig.name}`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{fieldConfig.label}</FormLabel>
                          <FormControl>
                            {fieldConfig.type === "textarea" ? (
                              <Textarea
                                {...field}
                                value={String(field.value ?? "")}
                              />
                            ) : fieldConfig.type === "boolean" ? (
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={Boolean(field.value)}
                                  onCheckedChange={field.onChange}
                                />
                                <span className="text-sm text-muted-foreground">
                                  {field.value ? "Yes" : "No"}
                                </span>
                              </div>
                            ) : (
                              <Input
                                type={fieldConfig.type}
                                {...field}
                                value={String(field.value ?? "")}
                              />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePreview}
                  disabled={previewMutation.isPending}
                >
                  {previewMutation.isPending ? "Loading..." : "Preview"}
                </Button>
                <Button
                  type="submit"
                  disabled={sendTestMutation.isPending || !form.watch("to")}
                >
                  {sendTestMutation.isPending
                    ? "Sending..."
                    : "Send Test Email"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            See how the email will look before sending.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {previewHtml ? (
            <div className="rounded border bg-white">
              <iframe
                srcDoc={previewHtml}
                className="h-[500px] w-full"
                title="Email Preview"
              />
            </div>
          ) : (
            <div className="flex h-[500px] items-center justify-center rounded border bg-muted/50 text-muted-foreground">
              Click "Preview" to see the email template
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
