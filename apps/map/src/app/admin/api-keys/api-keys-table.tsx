"use client";

import { MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { Spinner } from "@acme/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/table";
import { toast } from "@acme/ui/toast";

import { invalidateQueries, orpc, useMutation, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";

type ApiKeyRow = RouterOutputs["apiKey"]["list"]["apiKeys"][number];

type Status = "active" | "revoked" | "expired";

const statusBadgeVariant: Record<
  Status,
  "secondary" | "destructive" | "outline"
> = {
  active: "secondary",
  revoked: "destructive",
  expired: "outline",
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const deriveStatus = (row: ApiKeyRow): Status => {
  if (row.revokedAt) {
    return "revoked";
  }
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    return "expired";
  }
  return "active";
};

export const ApiKeysTable = () => {
  const { data, isLoading } = useQuery(orpc.apiKey.list.queryOptions());

  const revokeKey = useMutation(
    orpc.apiKey.revoke.mutationOptions({
      onSuccess: async (_result, variables) => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "apiKey",
        });
        toast.success(
          variables?.revoke === false
            ? "API key reactivated"
            : "API key revoked",
        );
      },
      onError: () => {
        toast.error("Unable to update API key status");
      },
    }),
  );

  const purgeKey = useMutation(
    orpc.apiKey.purge.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "apiKey",
        });
        toast.success("API key deleted");
      },
      onError: () => {
        toast.error("Unable to delete API key");
      },
    }),
  );

  const rows = useMemo(() => data?.apiKeys ?? [], [data?.apiKeys]);

  const confirmDelete = (id: number) => {
    const shouldDelete = window.confirm(
      "This will permanently delete the API key. Continue?",
    );
    if (shouldDelete) {
      purgeKey.mutate({ id });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Existing keys</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-5 w-5" />
          </div>
        ) : data?.apiKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <p>No API keys yet.</p>
            <p>Create one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Org scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const status = deriveStatus(row);
                  const displayKey = `•••• ${row.keySignature}`;

                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{row.name}</span>
                          {row.description ? (
                            <span className="text-xs text-muted-foreground">
                              {row.description}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                          <span>{displayKey}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{row.ownerName ?? "Unassigned"}</span>
                          <span className="text-xs text-muted-foreground">
                            {row.ownerEmail ?? "—"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {row.roles && row.roles.length > 0 ? (
                            row.roles.map((role, index) => {
                              const roleStyles = {
                                admin:
                                  "bg-purple-100 text-purple-700 border-purple-200",
                                editor:
                                  "bg-blue-100 text-blue-700 border-blue-200",
                              } as const;

                              const roleLabels = {
                                admin: "Admin",
                                editor: "Editor",
                              } as const;

                              return (
                                <span
                                  key={`${row.id}-${role.orgId}-${index}`}
                                  className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
                                    roleStyles[role.roleName]
                                  }`}
                                >
                                  {role.orgName} ({roleLabels[role.roleName]})
                                </span>
                              );
                            })
                          ) : (
                            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                              Read only
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant[status]}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateTime(row.lastUsedAt)}</TableCell>
                      <TableCell>{formatDateTime(row.created)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Open menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Manage</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                revokeKey.mutate({
                                  id: row.id,
                                  revoke: status === "revoked" ? false : true,
                                })
                              }
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              {status === "revoked"
                                ? "Restore access"
                                : "Revoke access"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => confirmDelete(row.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete key
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
