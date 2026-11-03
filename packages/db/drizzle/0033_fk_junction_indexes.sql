CREATE INDEX "idx_positions_x_orgs_x_users_user_id" ON "positions_x_orgs_x_users" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_positions_x_orgs_x_users_org_id" ON "positions_x_orgs_x_users" USING btree ("org_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_roles_x_users_x_org_user_id_org_id" ON "roles_x_users_x_org" USING btree ("user_id" int4_ops,"org_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_roles_x_users_x_org_org_id" ON "roles_x_users_x_org" USING btree ("org_id" int4_ops);