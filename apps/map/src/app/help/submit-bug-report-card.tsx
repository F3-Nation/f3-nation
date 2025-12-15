"use client";

import * as React from "react";

import type { FeedbackSchema } from "@acme/shared/app/constants";
import { feedbackSchema } from "@acme/shared/app/constants";
import { FeedbackType } from "@acme/shared/app/enums";
import { Button } from "@acme/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import {
  Form,
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
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import { orpc, useMutation } from "~/orpc/react";

const typeToTitle = (type: FeedbackType) => {
  switch (type) {
    case "bug":
      return "Bug Report";
    case "feature request":
      return "Feature Request";
    case "feedback":
      return "Feedback";
    default:
      return "Other";
  }
};

export const SubmitBugReportCard = () => {
  const id = React.useId();
  const submitFeedback = useMutation(orpc.map.submitFeedback.mutationOptions());
  const form = useForm({
    schema: feedbackSchema,
    defaultValues: {
      type: "feedback",
      subject: "",
      description: "",
      email: "",
    },
  });

  const type = form.watch("type");

  const onSubmit = (values: FeedbackSchema) => {
    console.log("SubmitBugReportCard", values);
    submitFeedback.mutate(values);
    toast.success(`${typeToTitle(values.type)} submitted`);
    form.reset();
  };

  return (
    <Form {...form}>
      <Card>
        <CardHeader>
          <CardTitle>Send us a message</CardTitle>
          <CardDescription>What would you like to tell us?</CardDescription>
        </CardHeader>
        <CardContent className="grid">
          <div className="grid sm:grid-cols-1">
            <div className="grid gap-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="py-1">
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={`area-${id}`} aria-label="Area">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {FeedbackType.map((type) => (
                          <SelectItem key={type} value={type}>
                            {typeToTitle(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem className="py-1">
                  <FormLabel>Subject</FormLabel>
                  <Input
                    id={`subject-${id}`}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={
                      type === "bug"
                        ? "When I do x, y happens, but I expected z"
                        : type === "feature request"
                          ? "I would like to see ..."
                          : type === "feedback"
                            ? "I have feedback about ..."
                            : "Other"
                    }
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-2">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="py-1">
                  <FormLabel>Description</FormLabel>
                  <Textarea
                    id={`description-${id}`}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Please include all information relevant to your issue."
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="py-1">
                  <FormLabel>Email</FormLabel>
                  <Input
                    id={`email-${id}`}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Please include your email if you'd like us to follow up with you."
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
        <CardFooter className="justify-between space-x-2">
          <Button
            size="sm"
            className="bg-black text-white hover:bg-gray-800"
            type="button"
            onClick={() => {
              console.log("SubmitBugReportCard", form.getValues());
              void form.handleSubmit(onSubmit, () =>
                window.alert("form error"),
              )();
            }}
          >
            Submit
          </Button>
        </CardFooter>
      </Card>
    </Form>
  );
};
