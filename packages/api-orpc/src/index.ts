import { map_admin_users_all } from "./routers/map-admin";

export { adminOp, editorOp, protectedOp, publicOp } from "./shared";

export const router = {
  mapAdmin: {
    users: {
      all: map_admin_users_all,
    },
  },
};
