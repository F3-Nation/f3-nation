export interface ChangelogEntry {
  version: string;
  date: string;
  title?: string;
  sections: {
    title: string;
    items: string[];
  }[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: "4.2.1",
    date: "2026-04-22",
    title: "Admin polish, map behavior & API hardening",
    sections: [
      {
        title: "Map",
        items: [
          "Nearby list groups workouts by AO so each AO is its own row when several AOs share one location.",
          "Event filters follow national event types with clearer handling across the map.",
          "AOs can inherit a parent region logo when they do not have their own; legacy map filter types that are no longer supported were removed.",
        ],
      },
      {
        title: "Admin Portal",
        items: [
          "Positions management: dedicated Positions experience and tools to assign roles by organization.",
          "Sortable admin tables; clearer URL validation and modal flows for links and social fields.",
          "Simpler org-scoped cache invalidation after AO changes; assorted small portal fixes and better direct-assignment flows.",
          "Annual review dates display correctly for admins in negative-offset timezones.",
        ],
      },
      {
        title: "API",
        items: [
          "Event instance handling cascades consistently through event and organization routes.",
        ],
      },
    ],
  },
  {
    version: "4.0.0",
    date: "2026-04-08",
    title: "Auth, Node 24, Pre-commit Hooks",
    sections: [
      {
        title: "Node 24",
        items: ["Upgraded repo from Node 20 to Node 24"],
      },
      {
        title: "Pre-commit Hooks",
        items: [
          "Added Lefthook that will check lint, format, and typecheck before commits.",
        ],
      },
      {
        title: "API",
        items: [
          "Feature: Added favicon",
          "Feature: Tied version shown on /docs to package.json instead of hardcoding it",
        ],
      },
      {
        title: "Auth",
        items: [
          "Feature: Migrated Auth into the mono repo. This is a phased approach. It will run as auth2.f3nation.com. We can now move apps over. Once all apps moved, we can decommission the stand alone auth and convert this to auth.f3nation.com.",
        ],
      },
    ],
  },
  {
    version: "3.9.1",
    date: "2026-03-26",
    title: "Map Updates & Admin Portal Improvements",
    sections: [
      {
        title: "Map Updates",
        items: [
          "Map now refreshes automatically when you add, edit, or approve workout changes - no manual refresh or revalidation needed",
        ],
      },
      {
        title: "Admin Portal",
        items: [
          "Bug Fix: Higher level admins can again grant access to lower orgs they manage.",
          "Feature: User pages now show Home Region",
          "Enhancement: Better experience when using the built-in map feature when editing a Location.",
          "Enhancement: Social media fields now require http or https in the field. This ensure people enter full URLs and not handles.",
        ],
      },
      {
        title: "API",
        items: [
          "Feature: /docs now displays a sample response for each endpoint, making it easier to understand the data structure and test API calls.",
          "Feature: /user/byEmail now returns more information on a user.",
        ],
      },
    ],
  },
  {
    version: "3.8.0",
    date: "2026-03-06",
    title: "Map Updates & Admin Portal Improvements",
    sections: [
      {
        title: "Map Updates",
        items: [
          "Map now refreshes automatically when you add, edit, or approve workout changes - no manual refresh or revalidation needed",
        ],
      },
      {
        title: "Admin Portal",
        items: [
          "Upload logos for AOs and Regions - images are automatically scaled and cropped to fit",
          "Sidebar now scrolls so you can navigate long menus on smaller screens",
          "Event category labels now appear in event type pickers to help you choose the right type",
          "Event modal only shows active locations - inactive locations no longer appear in the dropdown",
          "Mobile-friendly filter interface - filter tables easily on phones and tablets",
          "Improved layout and page titles across all admin pages for better navigation",
          "Status dropdown added to Location edit form so you can change Active/Inactive status",
        ],
      },
      {
        title: "API",
        items: [
          "New endpoints for event instances, attendance, and event tags",
          "Series exception support for marking series deviations and closures",
          "Org chart APIs with role information",
          "Improved query parameter handling for number inputs",
        ],
      },
    ],
  },
  {
    version: "3.7.2",
    date: "2026-02-17",
    title: "Code Login and Location Status",
    sections: [
      {
        title: "Bug Fixes",
        items: [
          "Login via code was case sensitive - now accepts codes regardless of case",
          "Admins could not change Active status of Location in Admin Portal",
        ],
      },
    ],
  },
  {
    version: "3.7.0",
    date: "2026-02-07",
    title: "Email URL Fix & Minor Improvements",
    sections: [
      {
        title: "Bug Fixes",
        items: [
          "Fixed map change request email links - View Request button now correctly points to map.f3nation.com instead of api.f3nation.com",
        ],
      },
      {
        title: "Backend",
        items: [
          "Renamed baseUrl to mapBaseUrl in email notification services for clarity",
        ],
      },
    ],
  },
  {
    version: "3.6.7",
    date: "2026-02-07",
    title: "Map Revalidation Fixes & API Improvements",
    sections: [
      {
        title: "Bug Fixes",
        items: [
          "Fixed revalidation button in map settings - now properly revalidates map cache when clicked",
          "API app revalidation endpoint now triggers map app cache revalidation via HTTP request",
          "Map cache updates immediately after database changes without requiring Cloud Build rebuild",
        ],
      },
      {
        title: "API",
        items: [
          "Moved revalidation endpoint from org router to map router for better organization",
          "Added position endpoints for SLT (Senior Leadership Team) position management",
          "Added source field to webhook data schema to prevent circular loops in external integrations",
        ],
      },
      {
        title: "Backend",
        items: [
          "Created dedicated revalidation endpoint in map app (/api/revalidate) that accepts internal API key authentication",
          "API app revalidation now makes HTTP request to map app to ensure both caches are updated",
          "Reorganized map router endpoints for better Scalar API documentation grouping",
        ],
      },
    ],
  },
  {
    version: "3.6.5",
    date: "2026-02-06",
    title: "Map Cache & Deleted Workout Fixes",
    sections: [
      {
        title: "Bug Fixes",
        items: [
          "Fixed crash when clicking on deleted workouts - deleted AOs/workouts no longer appear on the map",
          "Map now automatically updates when workouts or locations are created, updated, or deleted",
          "Fixed eventsAndLocations query to exclude inactive locations and locations with no active events",
        ],
      },
      {
        title: "Performance",
        items: [
          "Optimized map data query - switched from LEFT JOIN to INNER JOIN to reduce dataset size",
          "Map now only loads locations with active events, reducing initial data transfer and client-side processing",
        ],
      },
      {
        title: "Backend",
        items: [
          "Renamed emitWebhookEvent to notifyMapDataChange to better reflect its dual responsibility of webhook notifications and cache invalidation",
          "Added automatic Next.js cache revalidation when map data changes",
        ],
      },
    ],
  },
  {
    version: "3.6.4",
    date: "2026-02-04",
    title: "API Documentation",
    sections: [
      {
        title: "API",
        items: [
          "Added endpoint and parameter descriptions to API documentation",
        ],
      },
    ],
  },
  {
    version: "3.6.3",
    date: "2026-01-31",
    title: "Developer Tooling",
    sections: [
      {
        title: "Development",
        items: [
          "Added f3-git-workflow skill for consistent branching and merging",
        ],
      },
    ],
  },
  {
    version: "3.6.2",
    date: "2026-01-31",
    title: "Admin UX & Access Improvements",
    sections: [
      {
        title: "Admin Portal",
        items: [
          "Manage Access modal now only shows organizations where you are an admin",
          "Improved permission denied page - shows clear message and troubleshooting guide",
          "Event types now filter by your accessible orgs",
          "Better error messages when creating event types or managing roles without required permissions",
          "Events without locations now appear in admin event lists",
        ],
      },
      {
        title: "Map Improvements",
        items: [
          "Fixed AM/PM filter toggle - toggling one no longer affects the other",
          "Added DeletedWorkoutWarning for handling unavailable events gracefully",
          "Optimized map.event endpoints for faster filtering queries",
        ],
      },
      {
        title: "Backend",
        items: [
          "New org.accessible endpoint for getting user's accessible organizations",
          "Shared error constants for consistent error messaging",
          "Type safety improvements for nullable location handling",
        ],
      },
    ],
  },
  {
    version: "3.5.3",
    date: "2026-01-25",
    title: "API Enhancements, Webhooks & Admin Tools",
    sections: [
      {
        title: "New Features",
        items: [
          "Added changelog page - click the version number to view release history",
          "Added email template testing page for nation admins at /admin/email-test",
          "New dedicated count endpoints for events and organizations",
          "Enhanced filtering: filter events by event type name and category",
        ],
      },
      {
        title: "API Improvements",
        items: [
          "Added webhook notification system for map data changes",
          "External systems can now be notified when events, locations, or orgs are created, updated, or deleted",
          "Improved query parameter handling for array inputs in API endpoints",
          "Type-safe email templates with compile-time validation",
        ],
      },
      {
        title: "Backend",
        items: [
          "Created new @acme/mail package for consolidated email functionality",
          "Refactored event and org routers for better code organization (DRY)",
          "Converted email templates from Handlebars to type-safe TypeScript functions",
        ],
      },
    ],
  },
  {
    version: "3.4.0",
    date: "2026-01-17",
    title: "Contact Info on Workouts",
    sections: [
      {
        title: "New Features",
        items: [
          "Contact info now shows on workout cards! If you have a website, email, Twitter (X), Facebook, or Instagram configured for your Region OR AO, all of those links will show up on the info card for your workout",
          "FNGs and downrangers can now get in contact with you right from the map",
          "Update Region links at map.f3nation.com/admin/regions",
          "Update AO links at map.f3nation.com/admin/aos",
        ],
      },
      {
        title: "Notes",
        items: [
          "If you have websites, emails, etc. configured on BOTH an AO and a Region, they will both show up on the card",
          "Unless you have a specific contact/link for an AO that is different than the Region link, we recommend leaving the AO fields blank and only configuring them on the Region",
        ],
      },
    ],
  },
  {
    version: "3.3.0",
    date: "2026-01-15",
    title: "API & Backend Overhaul",
    sections: [
      {
        title: "Backend",
        items: [
          "F3 now has an API! Create your own read-only API key at map.f3nation.com/admin/api-keys",
          "API documentation available at api.f3nation.com/docs",
          "Contribute or suggest features on GitHub: github.com/F3-Nation/f3-nation",
        ],
      },
      {
        title: "Changes",
        items: [
          "There are now 2 user pages: All Users and My Users",
          "Privacy improvement: You can now only see email and phone numbers for people that are also Admin/Editors in your Region",
          "Updated process for creating users and giving admin access to your region",
        ],
      },
      {
        title: "F3 Ecosystem Updates",
        items: [
          "PAXminer (and QSignups and Weaselbot) will be turned off 3/31/26 - please review migration instructions",
          "PAX Vault (pax-vault.f3nation.com) is up and running for backblast analytics",
          "regions.f3nation.com continues to be a resource - some regions have replaced custom websites with it",
          "F3 Near Me temporarily redirects to the map while syncing to the new unified database",
        ],
      },
    ],
  },
  {
    version: "2.2.1",
    date: "2025-06-04",
    title: "User Search & Admin Improvements",
    sections: [
      {
        title: "New Features",
        items: [
          "Search Users table by who has permissions - filter by Org (e.g., Region) to see Admin/Editors",
          "AO Count column added to Sectors, Areas, and Regions tables in admin portal",
          "Filter Locations by Region in /admin/locations",
        ],
      },
      {
        title: "Bug Fixes",
        items: [
          "Regions can now be saved without entering an email address",
          "Phone number now shows up correctly in admin portal after saving",
          "Region filter by Area and Sector now properly links dropdown options",
        ],
      },
    ],
  },
  {
    version: "2.1.0",
    date: "2025-05-04",
    title: "AO Websites & Clustering Fixes",
    sections: [
      {
        title: "New Features",
        items: [
          "AO-specific websites - if both Region and AO have websites, both links will show on the map",
          "Admin Portal global sort now applies across all pages, not just the current page",
          "Admin Portal changes now show up on the map within seconds (may need to refresh)",
          "Filter Requests by 'Only Mine' and 'Pending'",
          "Sort by Region on AOs and Events tables",
        ],
      },
      {
        title: "Bug Fixes",
        items: [
          "Improved Location Clustering - all locations are now grouped above a certain zoom level",
          "Admins/Editors can now manage Region information (regression fix)",
          "Map no longer shows inactive events",
        ],
      },
    ],
  },
  {
    version: "2.0.2",
    date: "2025-04-30",
    title: "Custom Workout Types",
    sections: [
      {
        title: "New Features",
        items: [
          "Custom workout types - create your own workout types tied to your region at map.f3nation.com/admin/event-types",
          "Assign multiple types to a workout (e.g., an event can be both a Ruck AND a Run)",
          "Search results now indicate the Region that event belongs to",
          "Inactive filter in Admin Portal Events Page - view and reactivate inactive events",
          "Delete Locations via 3-dot menu in Admin Portal",
        ],
      },
      {
        title: "Bug Fixes",
        items: [
          "Event Description now properly populates when editing in Admin Portal",
        ],
      },
    ],
  },
];

export const getLatestVersion = (): string => {
  return changelog[0]?.version ?? "unknown";
};

export const getChangelogForVersion = (
  version: string,
): ChangelogEntry | undefined => {
  return changelog.find((entry) => entry.version === version);
};
