import { client } from "~/orpc/client";
import UserMutate from "./user-mutate";

export default async function UserEditPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const user = await client.user.byId({ id: Number(params.id) });
  return <UserMutate user={user} />;
}
