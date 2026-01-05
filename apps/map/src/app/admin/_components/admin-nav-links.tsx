import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Earth,
  CircleSmall,
  CirclePile,
  Globe,
  KeyRound,
  MapPin,
  PersonStanding,
  Shield,
  SquareChartGantt,
  Turtle,
  UserCheck,
  Users,
} from "lucide-react";

import { routes } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

interface AdminNavLinksProps {
  className?: string;
  linkClassName?: string;
  sectionClassName?: string;
}

type Link =
  | {
      href: string;
      icon: React.ElementType;
      label: string;
      type: "link";
    }
  | {
      icon?: React.ElementType;
      label: string;
      type: "section";
    };

export const AdminNavLinks = ({
  className,
  linkClassName,
  sectionClassName,
}: AdminNavLinksProps) => {
  const pathname = usePathname();

  const links: Link[] = [
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
      href: routes.admin.locations.__path,
      icon: MapPin,
      label: "Locations",
      type: "link",
    },
    {
      href: routes.admin.aos.__path,
      icon: CircleSmall,
      label: "AOs",
      type: "link",
    },
    {
      href: routes.admin.regions.__path,
      icon: CirclePile,
      label: "Regions",
      type: "link",
    },
    {
      href: routes.admin.areas.__path,
      icon: Earth,
      label: "Areas",
      type: "link",
    },
    {
      href: routes.admin.sectors.__path,
      icon: Globe,
      label: "Sectors",
      type: "link",
    },
    {
      href: routes.admin.theNation.__path,
      icon: Shield,
      label: "The Nation",
      type: "link",
    },
    {
      label: "Applications",
      type: "section",
    },
    {
      href: "/",
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
  ];

  return (
    <div className={className}>
      {links.map((link) => {
        if (link.type === "section") {
          return (
            <div
              key={link.label}
              className={cn(
                "mb-2 mt-2 text-base font-semibold",
                sectionClassName,
              )}
            >
              {link.label}
            </div>
          );
        }
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              pathname === link.href ? "bg-muted" : "",
              linkClassName,
            )}
            href={link.href}
          >
            <Icon className="h-5 w-5" />
            {link.label}
          </Link>
        );
      })}
    </div>
  );
};
