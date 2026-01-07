"use client";

import isNumber from "lodash/isNumber";
import { CheckCircle2, Plus, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { isValidEmail } from "@acme/shared/app/functions";
import type { RoleEntry } from "@acme/shared/app/types";
import { safeParseInt } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Command, CommandGroup, CommandItem } from "@acme/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
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
import { toast } from "@acme/ui/toast";
import { CrupdateUserSchema } from "@acme/validators";

import {
  ORPCError,
  invalidateQueries,
  orpc,
  useMutation,
  useQuery,
} from "~/orpc/react";
import type { DataType, ModalType } from "~/utils/store/modal";
import { closeModal } from "~/utils/store/modal";
import { VirtualizedCombobox } from "../virtualized-combobox";

export default function AdminGrantAccessModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_GRANT_ACCESS];
}) {
  const [emailPopoverOpen, setEmailPopoverOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(() => {
    return isNumber(data?.userId) ? data.userId : null;
  });
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const { data: orgs } = useQuery(
    orpc.org.all.queryOptions({
      input: { orgTypes: ["region", "area", "sector", "nation"] },
    }),
  );

  const form = useForm({
    schema: CrupdateUserSchema,
    defaultValues: {
      email: "",
      id: undefined,
      firstName: "",
      lastName: "",
      f3Name: "",
      phone: "",
      roles: [] as RoleEntry[],
    },
  });

  const emailValue = form.watch("email");

  // Fetch user by ID if userId is provided in data or when a user is selected
  const userIdToFetch = selectedUserId ?? data?.userId;
  const hasValidUserId =
    userIdToFetch !== undefined &&
    userIdToFetch !== null &&
    typeof userIdToFetch === "number" &&
    userIdToFetch > 0;
  const { data: userByIdData } = useQuery(
    orpc.user.byId.queryOptions({
      input: {
        id: hasValidUserId ? userIdToFetch : -1,
        // Must be false to avoid crashes
        includePii: false,
      },
      enabled: hasValidUserId,
      retry: false,
    }),
  );

  // Search user by email (exact match)
  const emailToSearch = emailValue?.trim();
  const { data: userByEmailResponse } = useQuery(
    orpc.user.byEmail.queryOptions({
      input: {
        email: emailToSearch ?? "",
        includePii: false,
      },
      enabled: isValidEmail(emailValue) && !!emailToSearch,
    }),
  );

  // Pre-fill form when user is loaded by ID (this is redundant with the useEffect below, but keeping for now)

  // Get exact email match (byEmail returns a single user or null)
  const exactEmailMatch = useMemo(() => {
    if (!userByEmailResponse?.user || !emailValue) return null;
    const user = userByEmailResponse.user;
    const lowerSearch = emailValue.toLowerCase().trim();
    // Verify the email matches exactly (case-insensitive)
    if (
      "email" in user &&
      user.email &&
      typeof user.email === "string" &&
      user.email.toLowerCase() === lowerSearch
    ) {
      return user as typeof user & {
        email: string;
        phone?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        f3Name?: string | null;
      };
    }
    return null;
  }, [userByEmailResponse, emailValue]);

  // Validate email format using robust validation
  const isEmailValid = useMemo(() => {
    return isValidEmail(emailValue);
  }, [emailValue]);

  // Build options for the email dropdown
  const emailOptions = useMemo(() => {
    const options: {
      value: string;
      label: string;
      id?: number;
      isCreateNew?: boolean;
    }[] = [];

    // Add exact email match if found
    if (exactEmailMatch?.email) {
      options.push({
        value: exactEmailMatch.email,
        label: `${exactEmailMatch.email}${exactEmailMatch.firstName ?? exactEmailMatch.lastName ? ` (${[exactEmailMatch.firstName, exactEmailMatch.lastName].filter(Boolean).join(" ")})` : ""}`,
        id: exactEmailMatch.id,
      });
    }

    // Add "Create New User" option if email is valid and no exact match
    if (isEmailValid && !exactEmailMatch) {
      options.push({
        value: `__create_new__${emailValue}`,
        label: `Create New User: ${emailValue}`,
        isCreateNew: true,
      });
    }

    return options;
  }, [exactEmailMatch, emailValue, isEmailValid]);

  const grantAccess = useMutation(
    orpc.user.crupdate.mutationOptions({
      onSuccess: async () => {
        // Invalidate all user-related queries to refresh tables
        await invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return (
              Array.isArray(key) &&
              key.length > 0 &&
              (key[0] === "user" ||
                (Array.isArray(key[0]) && key[0][0] === "user"))
            );
          },
        });
        closeModal();
        toast.success("Successfully granted access");
      },
      onError: (err) => {
        if (err instanceof ORPCError) {
          toast.error(err.message);
        } else {
          toast.error("Failed to grant access");
        }
      },
    }),
  );

  // Get the selected user object for display
  // Show user from email match if available, otherwise show user loaded by ID
  const selectedUser = useMemo(() => {
    if (selectedUserId) {
      // Prefer email match if available (has email)
      if (exactEmailMatch?.id === selectedUserId) {
        return exactEmailMatch;
      }
      // Fall back to user loaded by ID (may not have email/PII)
      if (userByIdData?.user?.id === selectedUserId) {
        return userByIdData.user;
      }
    }
    return null;
  }, [selectedUserId, exactEmailMatch, userByIdData]);

  const handleEmailSelect = (value: string) => {
    if (value.startsWith("__create_new__")) {
      // Extract email from the create new option
      const email = value.replace("__create_new__", "");
      form.setValue("email", email);
      form.setValue("id", undefined);
      setIsCreatingNew(true);
      setSelectedUserId(null);
      setEmailPopoverOpen(false);
    } else {
      // Find the selected user (should match exactEmailMatch)
      if (exactEmailMatch && exactEmailMatch.email === value) {
        form.setValue("email", exactEmailMatch.email);
        form.setValue("id", exactEmailMatch.id);
        setIsCreatingNew(false);
        setSelectedUserId(exactEmailMatch.id);
        setEmailPopoverOpen(false);
        // Pre-fill user data if available
        if (exactEmailMatch.firstName) {
          form.setValue("firstName", exactEmailMatch.firstName);
        }
        if (exactEmailMatch.lastName) {
          form.setValue("lastName", exactEmailMatch.lastName);
        }
        if (exactEmailMatch.f3Name) {
          form.setValue("f3Name", exactEmailMatch.f3Name);
        }
        if (exactEmailMatch.phone) {
          form.setValue("phone", exactEmailMatch.phone);
        }
      }
    }
  };

  const handleClearSelection = () => {
    form.setValue("email", "");
    form.setValue("id", undefined);
    form.setValue("firstName", "");
    form.setValue("lastName", "");
    form.setValue("f3Name", "");
    form.setValue("phone", "");
    form.setValue("roles", []);
    setSelectedUserId(null);
    setIsCreatingNew(false);
    setEmailPopoverOpen(false);
  };

  // Populate form fields when user data is loaded (from data prop or selected user)
  useEffect(() => {
    if (userByIdData?.user) {
      const user = userByIdData.user;
      // Set user ID - this marks it as an update operation
      form.setValue("id", user.id);
      setSelectedUserId(user.id);
      setIsCreatingNew(false);

      // Set email if available (may not be available without PII access)
      // Don't check if already set - always update from API response
      if (user.email) {
        form.setValue("email", user.email);
      } else {
        // Clear email if not available (user doesn't have PII access)
        form.setValue("email", "");
      }

      // Set other user fields if available
      form.setValue("firstName", user.firstName ?? "");
      form.setValue("lastName", user.lastName ?? "");
      form.setValue("f3Name", user.f3Name ?? "");
      form.setValue("phone", user.phone ?? "");

      // Always set existing roles from the API (source of truth)
      if (user.roles && Array.isArray(user.roles)) {
        const existingRoles: RoleEntry[] = user.roles.map((role) => ({
          orgId: role.orgId,
          roleName: role.roleName as "editor" | "admin",
        }));
        form.setValue("roles", existingRoles);
      } else {
        // If no roles found, clear the roles field
        form.setValue("roles", []);
      }
    }
  }, [userByIdData, form]);

  // Check if we can submit (either user selected or creating new)
  const canSubmit = selectedUserId !== null || isCreatingNew;

  // Show popover when there are options, but don't auto-open it
  // Let the user click to see options or they'll appear when typing a valid email
  useEffect(() => {
    // Only auto-open if we have options and the user hasn't selected anything yet
    if (emailOptions.length > 0 && !selectedUserId && !isCreatingNew) {
      // Don't force open - let it stay closed unless user focuses
      // The popover will open on focus if there are options
    } else if (emailOptions.length === 0) {
      // Close if no options
      setEmailPopoverOpen(false);
    }
  }, [emailOptions.length, selectedUserId, isCreatingNew]);

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">Grant Access</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              (data) => {
                // Validate that either a user is selected or we're creating new
                if (!canSubmit) {
                  toast.error(
                    "Please select an existing user or create a new user",
                  );
                  return;
                }
                // When updating an existing user (has id), email is not required
                // The API will handle PII restrictions and won't update email if not provided
                // For new users, email is required by the schema
                const submitData = data.id
                  ? { ...data, email: data.email ?? "" } // Allow empty email for updates
                  : data; // New users must have email (schema validation)
                grantAccess.mutate(submitData);
              },
              (error) => {
                toast.error("Failed to grant access");
                console.log(error);
              },
            )}
            className="space-y-4"
          >
            <div className="flex flex-wrap">
              <div className="mb-4 w-full px-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormDescription>
                        {data?.userId && !field.value
                          ? "Email is not available (no PII access). You can still update roles for this user."
                          : "Type an email address to search for existing users or create a new user."}
                      </FormDescription>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder={
                              data?.userId && !field.value
                                ? "Email not available"
                                : "user@example.com"
                            }
                            type="email"
                            disabled={!!data?.userId}
                            {...field}
                            value={field.value ?? ""}
                            autoComplete="off"
                            onChange={(e) => {
                              field.onChange(e);
                              setSelectedUserId(null);
                              setIsCreatingNew(false);
                              // Show dropdown when typing if there are options
                              if (e.target.value.length > 0) {
                                setEmailPopoverOpen(true);
                              } else {
                                setEmailPopoverOpen(false);
                              }
                            }}
                            onFocus={() => {
                              // Only open dropdown if there are options to show
                              if (emailOptions.length > 0) {
                                setEmailPopoverOpen(true);
                              }
                            }}
                            onBlur={(e) => {
                              // Delay closing to allow click events on dropdown items
                              // Check if the blur is happening because we clicked on a dropdown item
                              const relatedTarget =
                                e.relatedTarget as HTMLElement;
                              if (
                                !!relatedTarget?.closest('[role="listbox"]') ||
                                !!relatedTarget?.closest("[cmdk-item]")
                              ) {
                                // Don't close if clicking on dropdown
                                return;
                              }
                              setTimeout(() => {
                                const activeElement = document.activeElement;
                                if (
                                  !activeElement?.closest('[role="listbox"]') &&
                                  !activeElement?.closest("[cmdk-item]")
                                ) {
                                  setEmailPopoverOpen(false);
                                }
                              }, 200);
                            }}
                          />
                          {emailOptions.length > 0 && emailPopoverOpen && (
                            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                              <Command shouldFilter={false}>
                                <CommandGroup>
                                  {emailOptions.map((option) => (
                                    <CommandItem
                                      key={option.value}
                                      value={option.value}
                                      onSelect={() => {
                                        handleEmailSelect(option.value);
                                        setEmailPopoverOpen(false);
                                      }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleEmailSelect(option.value);
                                        setEmailPopoverOpen(false);
                                      }}
                                      onMouseDown={(e) => {
                                        // Prevent input blur when clicking
                                        e.preventDefault();
                                      }}
                                    >
                                      {option.label}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </Command>
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                      {/* Show selected user or new user indicator */}
                      {(!!selectedUser || !!isCreatingNew) && (
                        <div className="mt-2 rounded-md border bg-muted/50 p-3">
                          {selectedUser ? (
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-1 items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground">
                                    {(() => {
                                      const nameParts = [
                                        selectedUser.firstName,
                                        selectedUser.lastName,
                                      ].filter(Boolean);
                                      const displayName =
                                        nameParts.length > 0
                                          ? nameParts.join(" ")
                                          : "Selected User";
                                      return selectedUser.f3Name
                                        ? `${displayName} (${selectedUser.f3Name})`
                                        : displayName;
                                    })()}
                                  </p>
                                  {selectedUser.email ? (
                                    <p className="truncate text-sm text-muted-foreground">
                                      {selectedUser.email}
                                    </p>
                                  ) : (
                                    <p className="truncate text-sm text-muted-foreground italic">
                                      Email not available
                                    </p>
                                  )}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleClearSelection}
                                disabled={!!data?.userId}
                                className="h-8 w-8 flex-shrink-0 p-0"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : isCreatingNew ? (
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-1 items-start gap-2">
                                <UserPlus className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground">
                                    Creating New User
                                  </p>
                                  <p className="truncate text-sm text-muted-foreground">
                                    {emailValue}
                                  </p>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleClearSelection}
                                className="h-8 w-8 flex-shrink-0 p-0"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </FormItem>
                  )}
                />
              </div>

              {/* Show additional fields when creating new user */}
              {isCreatingNew && (
                <>
                  <div className="mb-4 w-1/2 px-2">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="First Name"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="mb-4 w-1/2 px-2">
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Last Name"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="mb-4 w-1/2 px-2">
                    <FormField
                      control={form.control}
                      name="f3Name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>F3 Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="F3 Name"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="mb-4 w-1/2 px-2">
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Phone"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              <div className="mb-4 w-full px-2">
                <FormField
                  control={form.control}
                  name="roles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Roles</FormLabel>
                      <FormDescription>
                        {selectedUserId && userByIdData?.user?.roles?.length
                          ? `Existing roles are shown below. Add or modify roles as needed.`
                          : `Assign roles to the user. They will be added to any existing roles.`}
                      </FormDescription>
                      <div className="space-y-2">
                        {((field.value as RoleEntry[]) || []).map(
                          (roleEntry, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-2"
                            >
                              <Select
                                onValueChange={(value) => {
                                  const newRoles = [
                                    ...(field.value as RoleEntry[]),
                                  ];
                                  newRoles[index] = {
                                    orgId: roleEntry.orgId,
                                    roleName: value as "editor" | "admin",
                                  };
                                  field.onChange(newRoles);
                                }}
                                value={roleEntry.roleName}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select a role" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="editor">Editor</SelectItem>
                                  <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                              </Select>

                              <VirtualizedCombobox
                                value={roleEntry.orgId.toString()}
                                options={
                                  orgs?.orgs.map((org) => ({
                                    value: org.id.toString(),
                                    label: `${org.name} (${org.orgType})`,
                                  })) ?? []
                                }
                                searchPlaceholder="Select an organization"
                                onSelect={(value) => {
                                  const orgId = safeParseInt(value as string);
                                  if (orgId == undefined) {
                                    toast.error("Invalid orgId");
                                    return;
                                  }
                                  const newRoles = [
                                    ...(field.value as RoleEntry[]),
                                  ];
                                  newRoles[index] = {
                                    roleName:
                                      newRoles[index]?.roleName ?? "editor",
                                    orgId,
                                  };
                                  field.onChange(newRoles);
                                }}
                                isMulti={false}
                              />

                              <Button
                                variant="ghost"
                                type="button"
                                size="sm"
                                onClick={() => {
                                  const newRoles = [
                                    ...(field.value as RoleEntry[]),
                                  ];
                                  newRoles.splice(index, 1);
                                  field.onChange(newRoles);
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ),
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-col">
                            <p className="text-xs text-gray-500">
                              Admins can invite & edit
                            </p>
                            <p className="text-xs text-gray-500">
                              Editors can edit
                            </p>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => {
                              const newRoleEntry: RoleEntry = {
                                roleName: "editor",
                                orgId: 1,
                              };
                              field.onChange([
                                ...((field.value as RoleEntry[]) ?? []),
                                newRoleEntry,
                              ]);
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Role
                          </Button>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="mb-4 w-full px-2">
                <div className="flex space-x-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => closeModal()}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!canSubmit}
                  >
                    {isCreatingNew
                      ? "Create & Grant Access"
                      : selectedUserId
                        ? "Grant Access"
                        : "Select or Create User"}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
