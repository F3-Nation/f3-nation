"use client";

import { LogOut } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

import { Avatar, AvatarFallback } from "@acme/ui/avatar";
import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";

export const AdminUserMenu = () => {
  const { data: session } = useSession();

  const userEmail = session?.user?.email ?? "";
  const userName = session?.user?.name ?? userEmail.split("@")[0] ?? "User";
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-auto w-full items-center justify-start gap-2 px-2 py-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col items-start overflow-hidden">
            <span className="truncate text-sm font-medium">{userName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {userEmail}
            </span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{userName}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {userEmail}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session?.roles && session.roles.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Roles
            </DropdownMenuLabel>
            <div className="px-2 py-1.5">
              <div className="flex flex-wrap gap-1">
                {session.roles.map((role) => {
                  const roleStyles = {
                    admin: "bg-purple-100 text-purple-700 border-purple-200",
                    editor: "bg-blue-100 text-blue-700 border-blue-200",
                    user: "bg-green-100 text-green-700 border-green-200",
                  } as const;
                  const roleStyle =
                    roleStyles[role.roleName as keyof typeof roleStyles] ??
                    "bg-muted text-muted-foreground border-muted";
                  return (
                    <span
                      key={`${role.orgId}-${role.roleName}`}
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${roleStyle}`}
                    >
                      {role.orgName} ({role.roleName})
                    </span>
                  );
                })}
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={async () => {
            await signOut({
              callbackUrl: "/",
            });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
