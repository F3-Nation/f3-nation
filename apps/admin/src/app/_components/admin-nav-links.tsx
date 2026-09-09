"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  Earth,
  CircleSmall,
  CirclePile,
  Globe,
  KeyRound,
  Mail,
  MapPin,
  PersonStanding,
  Shield,
  SquareChartGantt,
  Turtle,
  UserCheck,
  Users,
} from "lucide-react";

import { routes } from "@acme/shared/app/constants";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { orgAdminTypes } from "./org/org-admin-config";
import { cn } from "@acme/ui";

import { useAuth } from "~/utils/hooks/use-auth";

interface AdminNavLinksProps {
  className?: string;
  linkClassName?: string;
  mapUrl: string;
  sectionClassName?: string;
}

type NavLink =
  | {
      href: string;
      icon: React.ElementType;
      label: string;
      type: "link";
      nationAdminOnly?: boolean;
    }
  | {
      icon?: React.ElementType;
      label: string;
      type: "section";
      nationAdminOnly?: boolean;
    };

const orgIcons = { CircleSmall, CirclePile, Earth, Globe, Shield };

export const AdminNavLinks = ({
  className,
  linkClassName,
  mapUrl,
  sectionClassName,
}: AdminNavLinksProps) => {
  const pathname = usePathname();
  const { isNationAdmin } = useAuth();

  const links: NavLink[] = [
    {
      label: "Admin",
      type: "section",
    },
    {
      href: routes.admin.users.all.__path,
      icon: Users,
      label: "All Users",
      type: "link",
    },
    {
      href: routes.admin.users.mine.__path,
      icon: UserCheck,
      label: "My Users",
      type: "link",
    },
    {
      href: routes.admin.requests.__path,
      icon: SquareChartGantt,
      label: "Requests",
      type: "link",
    },
    {
      label: "Place Management (BETA)",
      type: "section",
    },
    {
      href: routes.admin.eventTypes.__path,
      icon: Turtle,
      label: "Event types",
      type: "link",
    },
    {
      href: routes.admin.workouts.__path,
      icon: PersonStanding,
      label: "Events",
      type: "link",
    },
    {
      href: routes.admin.positions.__path,
      icon: BadgeCheck,
      label: "Positions",
      type: "link",
    },
    {
      href: routes.admin.eventInstances.__path,
      icon: CalendarClock,
      label: "Event instances",
      type: "link",
    },
    {
      href: routes.admin.locations.__path,
      icon: MapPin,
      label: "Locations",
      type: "link",
    },
    ...orgAdminTypes.map((orgType) => {
      const display = orgTypeDisplay[orgType];
      return {
        href: `/${display.routeSegment}`,
        icon: orgIcons[display.icon],
        label: display.pluralLabel,
        type: "link" as const,
      };
    }),
    {
      label: "Applications",
      type: "section",
    },
    {
      href: mapUrl,
      icon: MapPin,
      label: "Map",
      type: "link",
    },
    {
      href: routes.admin.apiKeys.__path,
      icon: KeyRound,
      label: "API Keys",
      type: "link",
    },
    {
      label: "Nation Admin",
      type: "section",
      nationAdminOnly: true,
    },
    {
      href: routes.admin.emailTest.__path,
      icon: Mail,
      label: "Email Test",
      type: "link",
      nationAdminOnly: true,
    },
  ];

  // Filter out nation admin only links if user is not a nation admin
  const visibleLinks = links.filter(
    (link) => !link.nationAdminOnly || isNationAdmin,
  );

  return (
    <div className={className}>
      {visibleLinks.map((link) => {
        if (link.type === "section") {
          return (
            <div
              key={link.label}
              className={cn(
                "mt-2 mb-2 text-base font-semibold",
                sectionClassName,
              )}
            >
              {link.label}
            </div>
          );
        }
        const Icon = link.icon;
        const isExternal = link.href.startsWith("http");
        const linkClass = cn(
          "flex items-center gap-2 text-sm font-medium",
          !isExternal && pathname === link.href ? "bg-muted" : "",
          linkClassName,
        );
        return isExternal ? (
          <a
            key={link.href}
            className={linkClass}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon className="h-5 w-5" />
            {link.label}
          </a>
        ) : (
          <Link key={link.href} className={linkClass} href={link.href}>
            <Icon className="h-5 w-5" />
            {link.label}
          </Link>
        );
      })}
    </div>
  );
};
