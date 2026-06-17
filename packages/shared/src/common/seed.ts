import { faker } from "@faker-js/faker";

// Seed utils
export const fakeEnum = <T extends Record<string, string>>(
  enumVal: T,
): T[keyof T] =>
  faker.helpers.arrayElement(Object.values(enumVal)) as T[keyof T];

export const fakeEnums = <T extends Record<string, string>>(
  enumVal: T,
): T[keyof T][] =>
  faker.helpers.arrayElements(
    Object.values(enumVal),
    faker.number.int(Object.values(enumVal).length),
  ) as T[keyof T][];

export const fakeArray = (max: number, min?: number): null[] => {
  return Array(faker.number.int({ min: min ?? 1, max })).fill(null) as null[];
};
