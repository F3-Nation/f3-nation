import { redirect } from "next/navigation";

import { routes } from "@acme/shared/app/constants";

const AdminHome = async () => {
  redirect(routes.admin.requests.__path);
  return null;
};

export default AdminHome;
