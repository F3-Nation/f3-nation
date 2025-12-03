import { sql } from "drizzle-orm";
import {
  date,
  datetime,
  index,
  int,
  json,
  longtext,
  mysqlTable,
  mysqlView,
  primaryKey,
  tinyint,
  varchar,
} from "drizzle-orm/mysql-core";

export const achievementsAwarded = mysqlTable(
  "achievements_awarded",
  {
    id: int().autoincrement().notNull(),
    achievementId: int("achievement_id")
      .notNull()
      .references(() => achievementsList.id),
    paxId: varchar("pax_id", { length: 255 }).notNull(),
    // you can use { mode: 'date' }, if you want to have Date as type for this column
    dateAwarded: date("date_awarded", { mode: "string" }).notNull(),
    created: datetime({ mode: "string" })
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    updated: datetime({ mode: "string" })
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id], name: "achievements_awarded_id" }),
  ],
);

export const achievementsList = mysqlTable(
  "achievements_list",
  {
    id: int().autoincrement().notNull(),
    name: varchar({ length: 255 }).notNull(),
    description: varchar({ length: 255 }).notNull(),
    verb: varchar({ length: 255 }).notNull(),
    code: varchar({ length: 255 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id], name: "achievements_list_id" }),
  ],
);

export const aos = mysqlTable(
  "aos",
  {
    channelId: varchar("channel_id", { length: 45 }).notNull(),
    ao: varchar({ length: 45 }).notNull(),
    channelCreated: int("channel_created").notNull(),
    archived: tinyint().notNull(),
    backblast: tinyint(),
    siteQUserId: varchar("site_q_user_id", { length: 45 }),
  },
  (table) => [
    primaryKey({ columns: [table.channelId], name: "aos_channel_id" }),
  ],
);

export const bdAttendance = mysqlTable(
  "bd_attendance",
  {
    timestamp: varchar({ length: 45 }),
    tsEdited: varchar("ts_edited", { length: 45 }),
    userId: varchar("user_id", { length: 45 }).notNull(),
    aoId: varchar("ao_id", { length: 45 }).notNull(),
    date: varchar({ length: 45 }).notNull(),
    qUserId: varchar("q_user_id", { length: 45 }).notNull(),
    json: json(),
  },
  (table) => [
    index("fk_bd_attendance_aos1_idx").on(table.aoId),
    primaryKey({
      columns: [table.qUserId, table.userId, table.aoId, table.date],
      name: "bd_attendance_q_user_id_user_id_ao_id_date",
    }),
  ],
);

export const beatdowns = mysqlTable(
  "beatdowns",
  {
    timestamp: varchar({ length: 45 }),
    tsEdited: varchar("ts_edited", { length: 45 }),
    aoId: varchar("ao_id", { length: 45 }).notNull(),
    // you can use { mode: 'date' }, if you want to have Date as type for this column
    bdDate: date("bd_date", { mode: "string" }).notNull(),
    qUserId: varchar("q_user_id", { length: 45 }).notNull(),
    coqUserId: varchar("coq_user_id", { length: 45 }),
    paxCount: int("pax_count"),
    backblast: longtext(),
    backblastParsed: longtext("backblast_parsed"),
    fngs: varchar({ length: 45 }),
    fngCount: int("fng_count"),
    json: json(),
  },
  (table) => [
    index("fk_beatdowns_users1_idx").on(table.qUserId),
    primaryKey({
      columns: [table.aoId, table.bdDate, table.qUserId],
      name: "beatdowns_ao_id_bd_date_q_user_id",
    }),
  ],
);

export const users = mysqlTable(
  "users",
  {
    userId: varchar("user_id", { length: 45 }).notNull(),
    userName: varchar("user_name", { length: 45 }).notNull(),
    realName: varchar("real_name", { length: 45 }).notNull(),
    phone: varchar({ length: 45 }),
    email: varchar({ length: 45 }),
    // you can use { mode: 'date' }, if you want to have Date as type for this column
    startDate: date("start_date", { mode: "string" }),
    app: tinyint().default(0).notNull(),
    json: json(),
  },
  (table) => [primaryKey({ columns: [table.userId], name: "users_user_id" })],
);
export const achievementsView = mysqlView("achievements_view", {
  pax: varchar({ length: 45 }).notNull(),
  paxId: varchar("pax_id", { length: 45 }).notNull(),
  name: varchar({ length: 255 }).notNull(),
  description: varchar({ length: 255 }).notNull(),
  // you can use { mode: 'date' }, if you want to have Date as type for this column
  dateAwarded: date("date_awarded", { mode: "string" }).notNull(),
})
  .algorithm("undefined")
  .sqlSecurity("definer")
  .as(
    sql`select \`u\`.\`user_name\` AS \`pax\`,\`u\`.\`user_id\` AS \`pax_id\`,\`al\`.\`name\` AS \`name\`,\`al\`.\`description\` AS \`description\`,\`aa\`.\`date_awarded\` AS \`date_awarded\` from ((\`f3muletown\`.\`users\` \`u\` join \`f3muletown\`.\`achievements_awarded\` \`aa\` on((\`u\`.\`user_id\` = \`aa\`.\`pax_id\`))) join \`f3muletown\`.\`achievements_list\` \`al\` on((\`aa\`.\`achievement_id\` = \`al\`.\`id\`)))`,
  );

export const attendanceView = mysqlView("attendance_view", {
  date: varchar("Date", { length: 45 }).notNull(),
  ao: varchar("AO", { length: 45 }),
  pax: varchar("PAX", { length: 45 }),
  q: varchar("Q", { length: 45 }),
})
  .algorithm("undefined")
  .sqlSecurity("definer")
  .as(
    sql`select \`bd\`.\`date\` AS \`Date\`,\`ao\`.\`ao\` AS \`AO\`,\`u\`.\`user_name\` AS \`PAX\`,\`q\`.\`user_name\` AS \`Q\` from (((\`f3muletown\`.\`bd_attendance\` \`bd\` left join \`f3muletown\`.\`aos\` \`ao\` on((\`bd\`.\`ao_id\` = \`ao\`.\`channel_id\`))) left join \`f3muletown\`.\`users\` \`u\` on((\`bd\`.\`user_id\` = \`u\`.\`user_id\`))) left join \`f3muletown\`.\`users\` \`q\` on((\`bd\`.\`q_user_id\` = \`q\`.\`user_id\`))) order by \`bd\`.\`date\` desc,\`ao\`.\`ao\``,
  );

export const backblast = mysqlView("backblast", {
  // you can use { mode: 'date' }, if you want to have Date as type for this column
  date: date("Date", { mode: "string" }).notNull(),
  ao: varchar("AO", { length: 45 }),
  q: varchar("Q", { length: 45 }).notNull(),
  coQ: varchar("CoQ", { length: 45 }),
  paxCount: int("pax_count"),
  fngs: varchar({ length: 45 }),
  fngCount: int("fng_count"),
  backblast: longtext(),
})
  .algorithm("undefined")
  .sqlSecurity("definer")
  .as(
    sql`select \`B\`.\`bd_date\` AS \`Date\`,\`A\`.\`ao\` AS \`AO\`,\`U1\`.\`user_name\` AS \`Q\`,\`U2\`.\`user_name\` AS \`CoQ\`,\`B\`.\`pax_count\` AS \`pax_count\`,\`B\`.\`fngs\` AS \`fngs\`,\`B\`.\`fng_count\` AS \`fng_count\`,coalesce(\`B\`.\`backblast_parsed\`,\`B\`.\`backblast\`) AS \`backblast\` from (((\`f3muletown\`.\`beatdowns\` \`B\` join \`f3muletown\`.\`users\` \`U1\` on((\`U1\`.\`user_id\` = \`B\`.\`q_user_id\`))) left join \`f3muletown\`.\`aos\` \`A\` on((\`A\`.\`channel_id\` = \`B\`.\`ao_id\`))) left join \`f3muletown\`.\`users\` \`U2\` on((\`U2\`.\`user_id\` = \`B\`.\`coq_user_id\`))) order by \`B\`.\`bd_date\`,\`A\`.\`ao\``,
  );

export const beatdownInfo = mysqlView("beatdown_info", {
  // you can use { mode: 'date' }, if you want to have Date as type for this column
  date: date("Date", { mode: "string" }).notNull(),
  ao: varchar("AO", { length: 45 }),
  q: varchar("Q", { length: 45 }),
  qIsApp: tinyint("Q_Is_App").default(0),
  coQ: varchar("CoQ", { length: 45 }),
  paxCount: int("pax_count"),
  fngs: varchar({ length: 45 }),
  fngCount: int("fng_count"),
})
  .algorithm("undefined")
  .sqlSecurity("definer")
  .as(
    sql`select \`B\`.\`bd_date\` AS \`Date\`,\`a\`.\`ao\` AS \`AO\`,\`U1\`.\`user_name\` AS \`Q\`,\`U1\`.\`app\` AS \`Q_Is_App\`,\`U2\`.\`user_name\` AS \`CoQ\`,\`B\`.\`pax_count\` AS \`pax_count\`,\`B\`.\`fngs\` AS \`fngs\`,\`B\`.\`fng_count\` AS \`fng_count\` from (((\`f3muletown\`.\`beatdowns\` \`B\` left join \`f3muletown\`.\`users\` \`U1\` on((\`U1\`.\`user_id\` = \`B\`.\`q_user_id\`))) left join \`f3muletown\`.\`users\` \`U2\` on((\`U2\`.\`user_id\` = \`B\`.\`coq_user_id\`))) left join \`f3muletown\`.\`aos\` \`a\` on((\`a\`.\`channel_id\` = \`B\`.\`ao_id\`))) order by \`B\`.\`bd_date\`,\`a\`.\`ao\``,
  );
