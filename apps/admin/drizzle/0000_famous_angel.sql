-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `achievements_awarded` (
	`id` int AUTO_INCREMENT NOT NULL,
	`achievement_id` int NOT NULL,
	`pax_id` varchar(255) NOT NULL,
	`date_awarded` date NOT NULL,
	`created` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `achievements_awarded_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `achievements_list` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(255) NOT NULL,
	`verb` varchar(255) NOT NULL,
	`code` varchar(255) NOT NULL,
	CONSTRAINT `achievements_list_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `aos` (
	`channel_id` varchar(45) NOT NULL,
	`ao` varchar(45) NOT NULL,
	`channel_created` int NOT NULL,
	`archived` tinyint NOT NULL,
	`backblast` tinyint,
	`site_q_user_id` varchar(45),
	CONSTRAINT `aos_channel_id` PRIMARY KEY(`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `bd_attendance` (
	`timestamp` varchar(45),
	`ts_edited` varchar(45),
	`user_id` varchar(45) NOT NULL,
	`ao_id` varchar(45) NOT NULL,
	`date` varchar(45) NOT NULL,
	`q_user_id` varchar(45) NOT NULL,
	`json` json,
	CONSTRAINT `bd_attendance_q_user_id_user_id_ao_id_date` PRIMARY KEY(`q_user_id`,`user_id`,`ao_id`,`date`)
);
--> statement-breakpoint
CREATE TABLE `beatdowns` (
	`timestamp` varchar(45),
	`ts_edited` varchar(45),
	`ao_id` varchar(45) NOT NULL,
	`bd_date` date NOT NULL,
	`q_user_id` varchar(45) NOT NULL,
	`coq_user_id` varchar(45),
	`pax_count` int,
	`backblast` longtext,
	`backblast_parsed` longtext,
	`fngs` varchar(45),
	`fng_count` int,
	`json` json,
	CONSTRAINT `beatdowns_ao_id_bd_date_q_user_id` PRIMARY KEY(`ao_id`,`bd_date`,`q_user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` varchar(45) NOT NULL,
	`user_name` varchar(45) NOT NULL,
	`real_name` varchar(45) NOT NULL,
	`phone` varchar(45),
	`email` varchar(45),
	`start_date` date,
	`app` tinyint NOT NULL DEFAULT 0,
	`json` json,
	CONSTRAINT `users_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `achievements_awarded` ADD CONSTRAINT `fk_achievement_id` FOREIGN KEY (`achievement_id`) REFERENCES `achievements_list`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `fk_bd_attendance_aos1_idx` ON `bd_attendance` (`ao_id`);--> statement-breakpoint
CREATE INDEX `fk_beatdowns_users1_idx` ON `beatdowns` (`q_user_id`);--> statement-breakpoint
CREATE ALGORITHM = undefined
SQL SECURITY definer
VIEW `achievements_view` AS (select `u`.`user_name` AS `pax`,`u`.`user_id` AS `pax_id`,`al`.`name` AS `name`,`al`.`description` AS `description`,`aa`.`date_awarded` AS `date_awarded` from ((`f3muletown`.`users` `u` join `f3muletown`.`achievements_awarded` `aa` on((`u`.`user_id` = `aa`.`pax_id`))) join `f3muletown`.`achievements_list` `al` on((`aa`.`achievement_id` = `al`.`id`))));--> statement-breakpoint
CREATE ALGORITHM = undefined
SQL SECURITY definer
VIEW `attendance_view` AS (select `bd`.`date` AS `Date`,`ao`.`ao` AS `AO`,`u`.`user_name` AS `PAX`,`q`.`user_name` AS `Q` from (((`f3muletown`.`bd_attendance` `bd` left join `f3muletown`.`aos` `ao` on((`bd`.`ao_id` = `ao`.`channel_id`))) left join `f3muletown`.`users` `u` on((`bd`.`user_id` = `u`.`user_id`))) left join `f3muletown`.`users` `q` on((`bd`.`q_user_id` = `q`.`user_id`))) order by `bd`.`date` desc,`ao`.`ao`);--> statement-breakpoint
CREATE ALGORITHM = undefined
SQL SECURITY definer
VIEW `backblast` AS (select `B`.`bd_date` AS `Date`,`A`.`ao` AS `AO`,`U1`.`user_name` AS `Q`,`U2`.`user_name` AS `CoQ`,`B`.`pax_count` AS `pax_count`,`B`.`fngs` AS `fngs`,`B`.`fng_count` AS `fng_count`,coalesce(`B`.`backblast_parsed`,`B`.`backblast`) AS `backblast` from (((`f3muletown`.`beatdowns` `B` join `f3muletown`.`users` `U1` on((`U1`.`user_id` = `B`.`q_user_id`))) left join `f3muletown`.`aos` `A` on((`A`.`channel_id` = `B`.`ao_id`))) left join `f3muletown`.`users` `U2` on((`U2`.`user_id` = `B`.`coq_user_id`))) order by `B`.`bd_date`,`A`.`ao`);--> statement-breakpoint
CREATE ALGORITHM = undefined
SQL SECURITY definer
VIEW `beatdown_info` AS (select `B`.`bd_date` AS `Date`,`a`.`ao` AS `AO`,`U1`.`user_name` AS `Q`,`U1`.`app` AS `Q_Is_App`,`U2`.`user_name` AS `CoQ`,`B`.`pax_count` AS `pax_count`,`B`.`fngs` AS `fngs`,`B`.`fng_count` AS `fng_count` from (((`f3muletown`.`beatdowns` `B` left join `f3muletown`.`users` `U1` on((`U1`.`user_id` = `B`.`q_user_id`))) left join `f3muletown`.`users` `U2` on((`U2`.`user_id` = `B`.`coq_user_id`))) left join `f3muletown`.`aos` `a` on((`a`.`channel_id` = `B`.`ao_id`))) order by `B`.`bd_date`,`a`.`ao`);
*/