export const UserRole = ["user", "editor", "admin"] as const;
export type UserRole = (typeof UserRole)[number];

export const UserStatus = ["active", "inactive"] as const;
export type UserStatus = (typeof UserStatus)[number];

export const IsActiveStatus = ["active", "inactive"] as const;
export type IsActiveStatus = (typeof IsActiveStatus)[number];

export const RegionRole = ["user", "editor", "admin"] as const;
export type RegionRole = (typeof RegionRole)[number];

export const UpdateRequestStatus = ["pending", "approved", "rejected"] as const;
export type UpdateRequestStatus = (typeof UpdateRequestStatus)[number];

export const Permissions = ["admin", "edit"] as const;
export type Permissions = (typeof Permissions)[number];

export const OrgType = ["ao", "region", "area", "sector", "nation"] as const;
export type OrgType = (typeof OrgType)[number];

export const DayOfWeek = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type DayOfWeek = (typeof DayOfWeek)[number];

export const EventCadence = ["weekly", "monthly"] as const;
export type EventCadence = (typeof EventCadence)[number];

export const EventCategory = ["first_f", "second_f", "third_f"] as const;
export type EventCategory = (typeof EventCategory)[number];

export const RequestType = [
  "create_ao_and_location_and_event", // creates an ao and an event
  "create_event", // at an existing ao
  "edit_event", // edits event, ao, location, and region details
  "edit_ao_and_location", // edits event, ao, location, and region details
  "move_ao_to_different_region",
  "move_ao_to_new_location",
  "move_ao_to_different_location",
  "move_event_to_different_ao",
  "move_event_to_new_location",
  "delete_event",
  "delete_ao", // deletes an ao, its workouts, and possibly the location
  "edit", // I might need this for legacy purposes
] as const;
export type RequestType = (typeof RequestType)[number];

export enum EventTypes {
  Bootcamp = "Bootcamp",
  Run = "Run",
  Ruck = "Ruck",
  QSource = "QSource",
  Swimming = "Swimming",
  Mobility = "Mobility",
  Bike = "Bike",
  Gear = "Gear",
  "Wild Card" = "Wild Card",
  Sports = "Sports",
  // Cycling // Bike
  // CORE // Bootcamp
  // Run with Pain Stations // Run
  // Speed/Strength Running // Run
  // Obstacle Training // Gear
  // Strength/Conditioning/Tabata/WIB // Bootcamp
  // Mobility/Stretch // Mobility
}

export enum OrgTypes {
  AO = "AO",
  Region = "Region",
  Area = "Area",
  Sector = "Sector",
  Nation = "Nation",
}

export enum EventTags {
  Open = "Open",
  VQ = "VQ",
  Manniversary = "Manniversary",
  Convergence = "Convergence",
}

export enum EventCategories {
  "1st F - Core Workout" = "1st F - Core Workout",
  "1st F - Pre Workout" = "1st F - Pre Workout",
  "1st F - Off the books" = "1st F - Off the books",
  "2nd F - Fellowship" = "2nd F - Fellowship",
  "3rd F - Faith" = "3rd F - Faith",
}

export const FeedbackType = [
  "bug",
  "feature request",
  "feedback",
  "other",
] as const;
export type FeedbackType = (typeof FeedbackType)[number];

export const AchievementCadence = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "lifetime",
] as const;
export type AchievementCadence = (typeof AchievementCadence)[number];
