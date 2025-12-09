# Social Links Plan

- **Data shape**: Confirm the location/event payload includes AO-level socials (facebook, instagram, twitter) and region-level socials. If absent, extend `packages/api` tRPC location query and `packages/db` mapper to include those fields from the AO (location) row and region row. Keep names consistent (e.g., `aoFacebook`, `aoInstagram`, `aoTwitter`, `regionFacebook`, etc.).
- **API threading**: Update the `api.location.getLocationWorkoutData` procedure to select social fields and return them in the location object. Ensure serializers/validators (`packages/validators` if applicable) are updated to match.
- **UI selection logic**: In `apps/map/src/app/_components/workout/workout-details-content.tsx`, derive `socialLinks` with AO-first fallback:
  - For each platform (Facebook/Twitter/Instagram): pick AO value if truthy; else region value.
  - Filter out empty results; if none, skip the section entirely.
- **Render block**: Below “Region Information” (or near website), add a “Social” section that maps over the available links and renders them as `Link` elements with small platform icons or text labels. Keep it compact and optional—guard with the filtered list.
- **Skeleton/loading**: If the skeleton shows structural placeholders, either mirror the new section minimally or leave as-is since it’s optional content.
- **QA**: Manually verify an AO with unique socials shows its values, another without AO socials falls back to region, and one with neither hides the section. Optionally add a small unit test for the selector helper if extracted.

Quick references:

- https://map.f3nation.com/?eventId=45847&locationId=45849
- https://f3nation.slack.com/archives/CHSE1P26R/p1765308525489189?thread_ts=1763731538.919699&cid=CHSE1P26R
