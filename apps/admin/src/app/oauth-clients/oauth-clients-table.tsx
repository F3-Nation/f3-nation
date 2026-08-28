"use client";

import { MoreHorizontal, Pencil, Power } from "lucide-react";
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
import { ModalType, openModal } from "~/utils/store/modal";

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export const OauthClientsTable = () => {
  const { data, isLoading, isError } = useQuery(
    orpc.oauthClient.list.queryOptions(),
  );

  const updateClient = useMutation(
    orpc.oauthClient.update.mutationOptions({
      onSuccess: async (_result, variables) => {
        await invalidateQueries("oauthClient");
        toast.success(
          variables.disabled ? "Client disabled" : "Client re-enabled",
        );
      },
      onError: () => {
        toast.error("Unable to update client status");
      },
    }),
  );

  const rows = useMemo(() => data?.clients ?? [], [data?.clients]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Registered clients</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-5 w-5" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <p>Unable to load OAuth clients.</p>
            <p>Please try again.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <p>No OAuth clients yet.</p>
            <p>Create one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Client ID
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Redirect URIs
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Created
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.clientId}>
                    <TableCell className="font-medium">
                      {row.name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden font-mono text-sm sm:table-cell">
                      {row.clientId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.isPublic ? "outline" : "secondary"}>
                        {row.isPublic ? "Public (PKCE)" : "Confidential"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate md:table-cell">
                      {row.redirectUris.join(", ")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.disabled ? "destructive" : "secondary"}
                      >
                        {row.disabled ? "Disabled" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
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
                              openModal(ModalType.ADMIN_OAUTH_CLIENTS, {
                                clientId: row.clientId,
                              })
                            }
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className={
                              row.disabled
                                ? undefined
                                : "text-destructive focus:text-destructive"
                            }
                            onClick={() =>
                              updateClient.mutate({
                                clientId: row.clientId,
                                disabled: !row.disabled,
                              })
                            }
                          >
                            <Power className="mr-2 h-4 w-4" />
                            {row.disabled ? "Re-enable" : "Disable"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
