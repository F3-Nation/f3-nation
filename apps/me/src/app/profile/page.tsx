import { requireAuth } from "@/lib/auth/server";
import { getMyProfile, getRegions } from "@/lib/api/client";
import { ProfileForm } from "@/components/profile-form";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  await requireAuth();

  const [user, regions] = await Promise.all([getMyProfile(), getRegions()]);

  if (!user) {
    redirect("/?error=user_not_found");
  }

  return <ProfileForm user={user} regions={regions} />;
}
