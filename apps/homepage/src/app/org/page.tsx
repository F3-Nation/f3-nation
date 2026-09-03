import type { Metadata } from "next";
import { OrgMapLoader } from "./_components/org-map-loader";

export const metadata: Metadata = {
  title: "F3 Geographic Directory",
  description:
    "Explore F3 Nation's organizational structure — sectors, areas, regions, and AOs — on an interactive map.",
};

export default function OrgPage() {
  return <OrgMapLoader />;
}
