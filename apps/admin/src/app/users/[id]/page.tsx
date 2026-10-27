import { notFound } from "next/navigation";

import { client } from "~/orpc/client";
import UserMutate from "./user-mutate";

const MAX_INT4 = 2_147_483_647;

export default async function UserEditPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  // Reject ids the API would turn into a validation or Postgres range error.
  if (!/^\d+$/.test(params.id) || Number(params.id) > MAX_INT4) notFound();

  const userResponse = await client.user.byId({
    id: Number(params.id),
    includePii: true,
  });
  if (!userResponse.user) notFound();

  return <UserMutate user={userResponse.user} />;
}
