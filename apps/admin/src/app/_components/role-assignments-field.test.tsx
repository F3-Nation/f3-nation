import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoleAssignment } from "./role-assignments-field";
import { RoleAssignmentsField } from "./role-assignments-field";

// Native stand-ins for the pickers, so the test drives this field's logic.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    value,
    options,
    onSelect,
  }: {
    value?: string;
    options: { value: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <select
      aria-label="Organization"
      value={value ?? ""}
      onChange={(event) => onSelect(event.target.value)}
    >
      <option value="">None</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@acme/ui/multi-select", () => ({
  MultiSelect: ({
    options,
    defaultValue,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    defaultValue: string[];
    onValueChange: (value: string[]) => void;
  }) => (
    <fieldset aria-label="Roles">
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={defaultValue.includes(option.value)}
            onChange={(event) =>
              onValueChange(
                event.target.checked
                  ? [...defaultValue, option.value]
                  : defaultValue.filter((v) => v !== option.value),
              )
            }
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  ),
}));

const BOONE = { id: 8, name: "Boone", orgType: "region" as const };
const BOONE_AO = { id: 81, name: "The Pit", orgType: "ao" as const };

afterEach(cleanup);

function renderField(
  value: RoleAssignment[],
  onChange = vi.fn<(roles: RoleAssignment[]) => void>(),
) {
  const view = render(
    <RoleAssignmentsField
      value={value}
      onChange={onChange}
      orgOptions={[BOONE, BOONE_AO]}
      orgNames={new Map([[1, "F3 Nation"]])}
    />,
  );
  return { ...view, onChange };
}

const roleBoxes = (row: number) =>
  screen.getAllByRole("group", { name: "Roles" })[row]!;

describe("RoleAssignmentsField", () => {
  it("shows one row per org with all of its roles checked", () => {
    renderField([
      { orgId: 8, roleName: "password_manager" },
      { orgId: 8, roleName: "admin" },
    ]);

    expect(screen.getAllByRole("group", { name: "Roles" })).toHaveLength(1);
    const boxes = roleBoxes(0);
    expect(screen.getByLabelText<HTMLInputElement>("Admin").checked).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>("Password Manager").checked,
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>("Password Reader").checked,
    ).toBe(false);
    expect(boxes.textContent).toContain("Editor");
  });

  it("adds a second role on the same org", () => {
    const { onChange } = renderField([{ orgId: 8, roleName: "admin" }]);

    fireEvent.click(screen.getByLabelText("Password Reader"));

    expect(onChange).toHaveBeenLastCalledWith([
      { orgId: 8, roleName: "admin" },
      { orgId: 8, roleName: "password_reader" },
    ]);
  });

  it("offers password roles on regions only", () => {
    renderField([{ orgId: 81, roleName: "editor" }]);

    expect(roleBoxes(0).textContent).not.toContain("Password");
  });

  it("drops roles the newly chosen org's type doesn't offer", () => {
    const { onChange } = renderField([
      { orgId: 8, roleName: "editor" },
      { orgId: 8, roleName: "password_reader" },
    ]);

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "81" },
    });

    expect(onChange).toHaveBeenLastCalledWith([
      { orgId: 81, roleName: "editor" },
    ]);
  });

  it("keeps an org the editor can't manage read-only and in the value", () => {
    const { onChange } = renderField([
      { orgId: 1, roleName: "admin" },
      { orgId: 8, roleName: "editor" },
    ]);

    expect(screen.getByText("F3 Nation")).toBeTruthy();
    expect(screen.getAllByRole("group", { name: "Roles" })).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Password Manager"));

    expect(onChange).toHaveBeenLastCalledWith([
      { orgId: 1, roleName: "admin" },
      { orgId: 8, roleName: "editor" },
      { orgId: 8, roleName: "password_manager" },
    ]);
  });

  it("removes every role on an org when its row is removed", () => {
    const { onChange } = renderField([
      { orgId: 8, roleName: "admin" },
      { orgId: 8, roleName: "password_manager" },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove organization" }),
    );

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("adds a row with no org and no roles, which adds nothing to the value", () => {
    const { onChange } = renderField([]);

    fireEvent.click(screen.getByRole("button", { name: /Add organization/ }));

    expect(screen.getAllByRole("group", { name: "Roles" })).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();

    // Roles chosen before an org keep orgId -1 so the form can refuse them.
    fireEvent.click(screen.getByLabelText("Editor"));
    expect(onChange).toHaveBeenLastCalledWith([
      { orgId: -1, roleName: "editor" },
    ]);
  });

  it("reports an added org with no role as incomplete until a role is chosen", () => {
    const onIncompleteChange = vi.fn<(incomplete: boolean) => void>();
    render(
      <RoleAssignmentsField
        value={[{ orgId: 81, roleName: "editor" }]}
        onChange={vi.fn()}
        orgOptions={[BOONE, BOONE_AO]}
        onIncompleteChange={onIncompleteChange}
      />,
    );
    expect(onIncompleteChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /Add organization/ }));
    // No org chosen yet: the empty row would add nothing either way.
    expect(onIncompleteChange).toHaveBeenLastCalledWith(false);

    fireEvent.change(screen.getAllByLabelText("Organization")[1]!, {
      target: { value: "8" },
    });
    expect(onIncompleteChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(within(roleBoxes(1)).getByLabelText("Admin"));
    expect(onIncompleteChange).toHaveBeenLastCalledWith(false);
  });

  it("doesn't count clearing a loaded org's roles as incomplete", () => {
    const onIncompleteChange = vi.fn<(incomplete: boolean) => void>();
    render(
      <RoleAssignmentsField
        value={[{ orgId: 8, roleName: "admin" }]}
        onChange={vi.fn()}
        orgOptions={[BOONE]}
        onIncompleteChange={onIncompleteChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Admin"));

    expect(onIncompleteChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps every role when the current org is chosen again", () => {
    const { onChange } = renderField([
      { orgId: 81, roleName: "editor" },
      { orgId: 81, roleName: "password_reader" },
    ]);

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "81" },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText<HTMLInputElement>("Password Reader").checked,
    ).toBe(true);
  });

  it("needs a role again after a loaded row moves to an org that drops its only role", () => {
    const onIncompleteChange = vi.fn<(incomplete: boolean) => void>();
    const onChange = vi.fn();
    // Holds the value like a form does, so the field sees its own output.
    function Form() {
      const [value, setValue] = useState<RoleAssignment[]>([
        { orgId: 8, roleName: "password_reader" },
      ]);
      return (
        <RoleAssignmentsField
          value={value}
          onChange={(roles) => {
            onChange(roles);
            setValue(roles);
          }}
          orgOptions={[BOONE, BOONE_AO]}
          onIncompleteChange={onIncompleteChange}
        />
      );
    }
    render(<Form />);

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "81" },
    });

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onIncompleteChange).toHaveBeenLastCalledWith(true);
  });

  it("shows every row read-only when the org list failed to load", () => {
    const onChange = vi.fn<(roles: RoleAssignment[]) => void>();
    render(
      <RoleAssignmentsField
        value={[
          { orgId: 8, roleName: "admin" },
          { orgId: 8, roleName: "password_manager" },
        ]}
        onChange={onChange}
        orgOptions={[BOONE, BOONE_AO]}
        orgNames={new Map([[8, "Boone"]])}
        orgsFailed
      />,
    );

    expect(screen.queryByLabelText("Organization")).toBeNull();
    expect(screen.queryByRole("group", { name: "Roles" })).toBeNull();
    expect(screen.getByText("Admin, Password Manager")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Add organization/ }),
    ).toHaveProperty("disabled", true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rebuilds its rows when the value changes from outside", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RoleAssignmentsField
        value={[]}
        onChange={onChange}
        orgOptions={[BOONE]}
      />,
    );
    expect(screen.queryAllByRole("group", { name: "Roles" })).toHaveLength(0);

    rerender(
      <RoleAssignmentsField
        value={[{ orgId: 8, roleName: "password_reader" }]}
        onChange={onChange}
        orgOptions={[BOONE]}
      />,
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("Password Reader").checked,
    ).toBe(true);
  });
});
