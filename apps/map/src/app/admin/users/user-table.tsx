"use client";

import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";

import { UserRole, UserStatus } from "@acme/shared/app/enums";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@acme/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { MDTable, usePagination } from "@acme/ui/md-table";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { Cell, Header } from "@acme/ui/table";

import type { RouterOutputs } from "~/orpc/types";
import { orpc } from "~/orpc/react";
import { useDebounce } from "~/utils/hooks/use-debounce";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { OrgFilter } from "./org-filter";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

const UserRoleFilter = ({
  onRoleSelect,
  selectedRoles,
}: {
  onRoleSelect: (role: UserRole) => void;
  selectedRoles: UserRole[];
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-80">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedRoles.length > 0
              ? `${selectedRoles.length} role${selectedRoles.length > 1 ? "s" : ""}`
              : "Roles"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search roles..." />
            <CommandEmpty>No roles found.</CommandEmpty>
            <CommandGroup>
              {UserRole.map((role) => (
                <CommandItem
                  key={role}
                  value={role}
                  onSelect={() => {
                    onRoleSelect(role);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedRoles.includes(role)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

const UserStatusFilter = ({
  onStatusSelect,
  selectedStatuses,
}: {
  onStatusSelect: (status: UserStatus) => void;
  selectedStatuses: UserStatus[];
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-80">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedStatuses.length === 1 && selectedStatuses[0] === "active"
              ? "Active"
              : selectedStatuses.length === 1 &&
                  selectedStatuses[0] === "inactive"
                ? "Inactive"
                : "All statuses"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search statuses..." />
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup>
              {UserStatus.map((status) => (
                <CommandItem
                  key={status}
                  value={status}
                  onSelect={() => {
                    onStatusSelect(status as UserStatus);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedStatuses.includes(status as UserStatus)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export const UserTable = () => {
  const [selectedStatuses, setSelectedStatuses] = useState<UserStatus[]>([
    "active",
  ]);
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([
    "admin",
    "editor",
  ]);
  const [selectedOrgs, setSelectedOrgs] = useState<Org[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const { pagination, setPagination } = usePagination({
    pageSize: 20,
  });

  // Separate the role selection handler to have better control
  const handleRoleSelect = useCallback((role: UserRole) => {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) {
        return prev.filter((r) => r !== role);
      } else {
        return [...prev, role];
      }
    });
  }, []);

  const handleStatusSelect = useCallback((status: UserStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      } else {
        return [...prev, status];
      }
    });
  }, []);

  const handleOrgSelect = useCallback((org: Org) => {
    setSelectedOrgs((prev) => {
      if (prev.includes(org)) {
        return prev.filter((o) => o !== org);
      } else {
        return [...prev, org];
      }
    });
  }, []);

  const { data } = useQuery(
    orpc.user.all.queryOptions({
      input: {
        roles: selectedRoles,
        statuses: selectedStatuses,
        searchTerm: debouncedSearchTerm,
        pageSize: pagination.pageSize,
        pageIndex: pagination.pageIndex,
        orgIds: selectedOrgs.map((org) => org.id),
      },
    }),
  );

  return (
    <div className="relative">
      <MDTable
        data={data?.users}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        filterComponent={
          <>
            <OrgFilter
              onOrgSelect={handleOrgSelect}
              selectedOrgs={selectedOrgs}
            />
            <UserStatusFilter
              onStatusSelect={handleStatusSelect}
              selectedStatuses={selectedStatuses}
            />
            <UserRoleFilter
              onRoleSelect={handleRoleSelect}
              selectedRoles={selectedRoles}
            />
          </>
        }
        cellClassName="p-1"
        columns={columns}
        pagination={pagination}
        totalCount={data?.totalCount}
        setPagination={setPagination}
        onRowClick={(row) => {
          openModal(ModalType.ADMIN_USERS, { id: row.original.id });
        }}
        rowClassName={(row) => {
          if (row.original.status === "inactive") {
            return "opacity-30";
          }
        }}
      />
    </div>
  );
};

const columns: TableOptions<
  RouterOutputs["user"]["all"]["users"][number]
>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Name" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "f3Name",
    meta: { name: "F3 Name" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "roles",
    meta: { name: "Roles" },
    header: Header,
    cell: ({ row }) => {
      const roleStyles = {
        admin: "bg-purple-100 text-purple-700 border-purple-200",
        editor: "bg-blue-100 text-blue-700 border-blue-200",
        user: "bg-green-100 text-green-700 border-green-200",
      } as const;

      const roleLabels = {
        admin: "Admin",
        editor: "Editor",
        user: "User",
      } as const;

      return (
        <div className="flex flex-wrap items-center justify-start">
          {row.original.roles.map((role) => (
            <span
              key={role.orgId}
              className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
                roleStyles[role.roleName]
              }`}
            >
              {role.orgName} ({roleLabels[role.roleName]})
            </span>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    meta: { name: "Status" },
    header: Header,
    cell: ({ row }) => {
      const statusStyles = {
        active: "bg-green-100 text-green-700 border-green-200",
        inactive: "bg-red-100 text-red-700 border-red-200",
      } as const;

      const statusLabels = {
        active: "Active",
        inactive: "Inactive",
      } as const;

      return (
        <div className="flex items-center justify-start">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
              statusStyles[row.original.status]
            }`}
          >
            {statusLabels[row.original.status]}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "email",
    meta: { name: "Email" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },

  {
    accessorKey: "phone",
    meta: { name: "Phone" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "regions",
    meta: { name: "Regions" },
    header: Header,
    cell: (cell) => (
      <Cell {...cell}>
        {cell.row.original.roles.map((role) => role.orgName).join(", ")}
      </Cell>
    ),
  },
  // {
  //   accessorKey: "emergencyContact",
  //   meta: { name: "Emergency Contact" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "emergencyPhone",
  //   meta: { name: "Emergency Phone" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "emergencyNotes",
  //   meta: { name: "Emergency Notes" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },

  {
    accessorKey: "created",
    accessorFn: (row) => new Date(row.created).toLocaleDateString(),
    meta: { name: "Created At" },
    header: Header,
    cell: Cell,
  },

  {
    id: "id",
    enableHiding: false,
    cell: ({ row }) => {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <DotsHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                  id: Number(row.original.id),
                  type: DeleteType.USER,
                });
              }}
            >
              <div>Delete</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
