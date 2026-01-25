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
    version: "3.5.1",
    date: "2026-01-24",
    title: "Changelog, Webhooks & Email Testing",
    sections: [
      {
        title: "New Features",
        items: [
          "Added changelog page - click the version number to view release history",
          "Added email template testing page for nation admins at /admin/email-test",
        ],
      },
      {
        title: "Backend",
        items: [
          "Added webhook notification system for map data changes",
          "External systems can now be notified when events, locations, or orgs are created, updated, or deleted",
          "Created new @acme/mail package for email functionality",
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
