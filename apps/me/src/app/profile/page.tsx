import { requireAuth } from "@/lib/auth/server";
import { getUser, getRegions } from "@/lib/api/client";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const session = await requireAuth();
  const userId = Number(session.sub);

  const [user, regions] = await Promise.all([getUser(userId), getRegions()]);

  // Extract positions from user data
  // The API may include position data in the user response,
  // but if not, we return an empty array (positions are loaded on-demand)
  const positions: {
    orgId: number;
    orgName?: string;
    positionId: number;
    positionName: string;
  }[] = [];

  return <ProfileForm user={user} regions={regions} positions={positions} />;
}
