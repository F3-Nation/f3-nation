import { Globe, Mail, Phone } from "lucide-react";
import Link from "next/link";

import { cn } from "@acme/ui";

import FacebookSvgComponent from "./SVGs/facebook";
import InstagramSvgComponent from "./SVGs/instagram";
import XSvgComponent from "./SVGs/x";

interface ContactInfo {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  instagram?: string | null;
}

interface ContactLinksProps {
  contact: ContactInfo;
  className?: string;
  iconSize?: "sm" | "md" | "lg";
}

const iconSizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const buttonSizes = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

/**
 * Displays contact links as icon buttons.
 * Shows icons for website, email, phone, twitter, facebook, and instagram if provided.
 */
export const ContactLinks = ({
  contact,
  className,
  iconSize = "md",
}: ContactLinksProps) => {
  const { website, email, phone, twitter, facebook, instagram } = contact;

  const hasAnyContact =
    website ?? email ?? phone ?? twitter ?? facebook ?? instagram;
  if (!hasAnyContact) return null;

  const iconClass = iconSizes[iconSize];
  const buttonClass = cn(
    "rounded-full bg-muted transition-colors hover:bg-muted-foreground/20",
    buttonSizes[iconSize],
  );

  // Normalize URLs to ensure they have https://
  const normalizeUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return `https://${url}`;
  };

  // Normalize social media handles to full URLs
  const normalizeTwitterUrl = (handle: string | null | undefined) => {
    if (!handle) return null;
    if (handle.startsWith("http")) return handle;
    // Remove @ if present
    const cleanHandle = handle.startsWith("@") ? handle.slice(1) : handle;
    return `https://x.com/${cleanHandle}`;
  };

  const normalizeFacebookUrl = (handle: string | null | undefined) => {
    if (!handle) return null;
    if (handle.startsWith("http")) return handle;
    return `https://facebook.com/${handle}`;
  };

  const normalizeInstagramUrl = (handle: string | null | undefined) => {
    if (!handle) return null;
    if (handle.startsWith("http")) return handle;
    // Remove @ if present
    const cleanHandle = handle.startsWith("@") ? handle.slice(1) : handle;
    return `https://instagram.com/${cleanHandle}`;
  };

  const links = [
    {
      url: normalizeUrl(website),
      icon: Globe,
      label: "Website",
    },
    {
      url: email ? `mailto:${email}` : null,
      icon: Mail,
      label: "Email",
    },
    {
      url: phone ? `tel:${phone}` : null,
      icon: Phone,
      label: "Phone",
    },
    {
      url: normalizeTwitterUrl(twitter),
      icon: XSvgComponent,
      label: "X (Twitter)",
    },
    {
      url: normalizeFacebookUrl(facebook),
      icon: FacebookSvgComponent,
      label: "Facebook",
    },
    {
      url: normalizeInstagramUrl(instagram),
      icon: InstagramSvgComponent,
      label: "Instagram",
    },
  ].filter((link) => link.url);

  return (
    <div className={cn("flex flex-row flex-wrap gap-2", className)}>
      {links.map(({ url, icon: Icon, label }) => (
        <Link
          key={label}
          href={url!}
          target={
            url!.startsWith("mailto:") || url!.startsWith("tel:")
              ? undefined
              : "_blank"
          }
          rel="noopener noreferrer"
          className={buttonClass}
          title={label}
          aria-label={label}
        >
          <Icon className={iconClass} />
        </Link>
      ))}
    </div>
  );
};
