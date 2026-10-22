import { Mail } from "lucide-react";

import FacebookSvgComponent from "@/components/svgs/facebook";
import InstagramSvgComponent from "@/components/svgs/instagram";
import XSvgComponent from "@/components/svgs/x";

interface RegionHeaderProps {
  regionName: string;
  website?: string;
  email?: string;
  facebook?: string;
  twitter?: string;
  instagram?: string;
}

export function RegionHeader({
  regionName,
  website,
  email,
  facebook,
  twitter,
  instagram,
}: RegionHeaderProps) {
  const socialLinks = [
    {
      name: "Email",
      url: email ? `mailto:${email}` : undefined,
      icon: <Mail className="size-4" />,
    },
    {
      name: "Facebook",
      url: facebook,
      icon: <FacebookSvgComponent className="size-4" />,
    },
    { name: "X", url: twitter, icon: <XSvgComponent className="size-4" /> },
    {
      name: "Instagram",
      url: instagram,
      icon: <InstagramSvgComponent className="size-4" />,
    },
  ].filter((link) => link.url);

  return (
    <div className="mb-8 space-y-2">
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          title={`F3 ${regionName}`}
        >
          Visit Region Website
        </a>
      )}

      {socialLinks.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {socialLinks.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-700 transition-colors hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
              title={`F3 ${regionName} ${link.name}`}
            >
              {link.icon}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
