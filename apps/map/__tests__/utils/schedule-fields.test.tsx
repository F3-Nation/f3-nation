import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Form, useForm } from "@acme/ui/form";
import { ScheduleFields } from "@acme/ui/schedule-select";
import { z } from "zod";

const schema = z
  .object({
    recurrencePattern: z.enum(["weekly", "monthly"]).nullable(),
    recurrenceInterval: z.number().nullable(),
    indexWithinInterval: z.number().nullable(),
  })
  .superRefine((data, ctx) => {
    if (
      data.recurrencePattern === "monthly" &&
      data.indexWithinInterval == null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["indexWithinInterval"],
        message: "Select which occurrence of the month",
      });
    }
  });

const TestForm = ({
  defaultValues,
}: {
  defaultValues?: Partial<z.infer<typeof schema>>;
}) => {
  const form = useForm({
    schema,
    defaultValues: {
      recurrencePattern: null,
      recurrenceInterval: null,
      indexWithinInterval: null,
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => {
          // no-op for test
        })}
      >
        <ScheduleFields
          control={form.control}
          recurrencePatternName="recurrencePattern"
          recurrenceIntervalName="recurrenceInterval"
          indexWithinIntervalName="indexWithinInterval"
        />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
};

describe("ScheduleFields", () => {
  it("does not show the occurrence field for weekly", () => {
    render(<TestForm />);
    expect(screen.queryByText("Which occurrence?")).not.toBeInTheDocument();
  });

  it("shows a truthful custom option instead of collapsing an interval-3 schedule into weekly", () => {
    render(
      <TestForm
        defaultValues={{ recurrencePattern: "weekly", recurrenceInterval: 3 }}
      />,
    );
    expect(screen.getAllByText("Every 3 weeks").length).toBeGreaterThan(0);
  });

  it("reveals the occurrence field and blocks submit until one is chosen for monthly", async () => {
    render(<TestForm defaultValues={{ recurrencePattern: "monthly" }} />);

    expect(screen.getByText("Which occurrence?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText("Select which occurrence of the month"),
    ).toBeInTheDocument();
  });
});
