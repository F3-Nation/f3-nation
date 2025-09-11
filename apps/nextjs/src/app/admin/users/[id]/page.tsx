import { api } from "~/trpc/server";
import UserMutate from "./user-mutate";

export default async function UserEditPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const user = await api.user.byId({ id: Number(params.id) });
  return <UserMutate user={user} />;
}
