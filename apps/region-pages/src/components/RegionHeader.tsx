import {
  FaFacebookSquare,
  FaInstagramSquare,
  FaTwitterSquare,
} from 'react-icons/fa';
import { MdEmail } from 'react-icons/md';

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
      name: 'Email',
      url: email ? `mailto:${email}` : undefined,
      icon: <MdEmail />,
    },
    { name: 'Facebook', url: facebook, icon: <FaFacebookSquare /> },
    { name: 'Twitter', url: twitter, icon: <FaTwitterSquare /> },
    { name: 'Instagram', url: instagram, icon: <FaInstagramSquare /> },
  ].filter((link) => link.url);

  return (
    <div className="mb-8 space-y-2">
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
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
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
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
