import { client } from "~/orpc/client";
import UserMutate from "./user-mutate";

export default async function UserEditPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const userResponse = await client.user.byId({
    id: Number(params.id),
    includePii: true,
  });
  return <UserMutate user={userResponse.user} />;
}
