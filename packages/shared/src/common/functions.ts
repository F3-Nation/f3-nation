import get from "lodash/get";
import set from "lodash/set";

import type { GetFieldType, Truthy } from "./types";
import { Case } from "./enums";

export function isTruthy<T>(value: T): value is Truthy<T> {
  return Boolean(value);
}

// https://stackoverflow.com/questions/7905929/how-to-test-valid-uuid-guid
export const isUuid = (uuid: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    uuid,
  );

export const bound = (
  variable: number,
  min: number | undefined,
  max: number | undefined,
) => {
  const withMin = min === undefined ? variable : Math.max(variable, min);
  const withMaxAndMin = max === undefined ? withMin : Math.min(withMin, max);
  return withMaxAndMin;
};

export const stringToNum = (word: string) =>
  word
    .split("")
    .reduce(
      (accu, letter, idx, arr) =>
        accu + (letter.charCodeAt(0) - 96) * Math.pow(26, arr.length - idx - 1),
      0,
    );

export const numToString = (num: number) => {
  let columnLetter = "";
  let t = 0;

  while (num > 0) {
    t = (num - 1) % 26;
    columnLetter = String.fromCharCode(65 + t) + columnLetter;
    num = ((num - t) / 26) | 0;
  }
  return columnLetter.toLowerCase() || undefined;
};

const addAlphaToHex = (color: string, opacity: number): string => {
  // coerce values so ti is between 0 and 1.
  const _opacity = Math.round(bound(opacity ?? 1, 0, 1) * 255);
  return color + _opacity.toString(16).toUpperCase();
};

const addAlphaToRGB = (color: string, opacity: number): string => {
  return color.replace(
    /rgba?(\(\s*\d+\s*,\s*\d+\s*,\s*\d+)(?:\s*,.+?)?\)/,
    `rgba$1,${bound(opacity || 1, 0, 1)})`,
  );
};

export const addAlpha = (color: string, opacity: number): string =>
  color.includes("rgb")
    ? addAlphaToRGB(color, opacity)
    : addAlphaToHex(color, opacity);

export function classNames(...classes: (string | undefined)[]) {
  return classes.filter(isTruthy).join(" ");
}

export const camelCaseToSpacedTitleCase = (camelCase: string) =>
  camelCase
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase());

export const getJwtContent = <T extends object>(
  token: string | undefined,
): T | undefined => {
  const bufferable = token?.split(".")[1];
  return bufferable
    ? (JSON.parse(Buffer.from(bufferable, "base64").toString()) as T)
    : undefined;
};

export function sleep(milliseconds: number) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

// https://stackoverflow.com/questions/8206269/how-to-remove-http-from-a-url-in-javascript
export const removeProtocol = (url: string) => url.replace(/(^\w+:|^)\/\//, "");

export const isUpperCase = (str: string | undefined) =>
  str && str === str.toUpperCase();
export const isLowerCase = (str: string | undefined) =>
  str && str === str.toLowerCase();

const MODIFIERS = ["-", "_", " ", "."];

// If there is no modifier then that is fine (MODIFIER is Screaming Snake Case)
export const hasOnlyModifier = (
  str: string | undefined,
  modifier?: "-" | "_" | " " | ".", // Pass nothing to check for no modifier
) =>
  str && MODIFIERS.filter((m) => m !== modifier).every((m) => !str.includes(m));

export const getCase = (str: string): Case => {
  if (hasOnlyModifier(str, "-") && isLowerCase(str)) {
    return Case.KebabCase;
  } else if (hasOnlyModifier(str, "-") && isUpperCase(str)) {
    return Case.TrainCase;
  } else if (hasOnlyModifier(str, "_") && isLowerCase(str)) {
    return Case.SnakeCase;
  } else if (hasOnlyModifier(str, "_") && isUpperCase(str)) {
    return Case.ScreamingSnakeCase;
  } else if (hasOnlyModifier(str) && isLowerCase(str[0])) {
    return Case.PascalCase;
  } else if (hasOnlyModifier(str) && isUpperCase(str[0])) {
    return Case.CamelCase;
  } else if (
    hasOnlyModifier(str, " ") &&
    isUpperCase(str[0]) &&
    !/ [a-z]/g.test(str)
  ) {
    return Case.TitleCase;
  } else if (
    hasOnlyModifier(str, " ") &&
    isUpperCase(str[0]) &&
    !/ [A-Z]/g.test(str)
  ) {
    return Case.SentenceCase;
  } else {
    return Case.UnknownCase;
  }
};

export const convertCase = ({
  str,
  toCase,
  fromCase: fromCaseRaw,
}: {
  str: string;
  toCase: Case;
  fromCase?: Case;
}): string => {
  const fromCase = fromCaseRaw ?? getCase(str);
  switch (fromCase) {
    case Case.LowerCase:
      switch (toCase) {
        case Case.TitleCase:
          return str[0]?.toUpperCase() + str.slice(1);
        default:
          throw new Error(`Cannot convert ${fromCase} to ${toCase}`);
      }
    case Case.CamelCase:
      switch (toCase) {
        case Case.PascalCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1$2")
            .replace(/^./, (str) => str.toUpperCase());
        case Case.SnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        case Case.KebabCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        case Case.TitleCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
        case Case.TrainCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toUpperCase();
        case Case.ScreamingSnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
        case Case.SentenceCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.PascalCase:
      switch (toCase) {
        case Case.CamelCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1$2")
            .replace(/^./, (str) => str.toLowerCase());
        case Case.SnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        case Case.KebabCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        case Case.TitleCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
        case Case.TrainCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toUpperCase();
        case Case.ScreamingSnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
        case Case.SentenceCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.SnakeCase:
      switch (toCase) {
        case Case.CamelCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", "").replace("_", ""),
          );
        case Case.PascalCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", "").replace("_", ""),
            )
            .replace(/^./, (str) => str.toUpperCase());
        case Case.KebabCase:
          return str.replace(/_/g, "-");
        case Case.TitleCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", " ").replace("_", " "),
          );
        case Case.TrainCase:
          return str.toUpperCase();
        case Case.ScreamingSnakeCase:
          return str.toUpperCase();
        case Case.SentenceCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", " ").replace("_", " "),
            )
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.KebabCase:
      switch (toCase) {
        case Case.CamelCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", "").replace("_", ""),
          );
        case Case.PascalCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", "").replace("_", ""),
            )
            .replace(/^./, (str) => str.toUpperCase());
        case Case.SnakeCase:
          return str.replace(/-/g, "_");
        case Case.TitleCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", " ").replace("_", " "),
          );
        case Case.TrainCase:
          return str.toUpperCase();
        case Case.ScreamingSnakeCase:
          return str.toUpperCase();
        case Case.SentenceCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", " ").replace("_", " "),
            )
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.TitleCase:
      switch (toCase) {
        case Case.CamelCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1$2")
            .replace(/^./, (str) => str.toLowerCase());
        case Case.PascalCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1$2")
            .replace(/^./, (str) => str.toUpperCase());
        case Case.SnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        case Case.KebabCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        case Case.TrainCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toUpperCase();
        case Case.ScreamingSnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
        case Case.SentenceCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.TrainCase:
      switch (toCase) {
        case Case.CamelCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", "").replace("_", ""),
          );
        case Case.PascalCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", "").replace("_", ""),
            )
            .replace(/^./, (str) => str.toUpperCase());
        case Case.SnakeCase:
          return str.replace(/-/g, "_");
        case Case.KebabCase:
          return str.toLowerCase();
        case Case.TitleCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", " ").replace("_", " "),
          );
        case Case.ScreamingSnakeCase:
          return str.toUpperCase();
        case Case.SentenceCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", " ").replace("_", " "),
            )
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.ScreamingSnakeCase:
      switch (toCase) {
        case Case.CamelCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", "").replace("_", ""),
          );
        case Case.PascalCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", "").replace("_", ""),
            )
            .replace(/^./, (str) => str.toUpperCase());
        case Case.SnakeCase:
          return str.toLowerCase();
        case Case.KebabCase:
          return str.toLowerCase();
        case Case.TitleCase:
          return str.replace(/([-_][a-z])/g, (group) =>
            group.toUpperCase().replace("-", " ").replace("_", " "),
          );
        case Case.TrainCase:
          return str.toLowerCase();
        case Case.SentenceCase:
          return str
            .replace(/([-_][a-z])/g, (group) =>
              group.toUpperCase().replace("-", " ").replace("_", " "),
            )
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    case Case.SentenceCase:
      switch (toCase) {
        case Case.CamelCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1$2")
            .replace(/^./, (str) => str.toLowerCase());
        case Case.PascalCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1$2")
            .replace(/^./, (str) => str.toUpperCase());
        case Case.SnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        case Case.KebabCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        case Case.TrainCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toUpperCase();
        case Case.ScreamingSnakeCase:
          return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
        case Case.TitleCase:
          return str
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/^./, (str) => str.toUpperCase());
        default:
          return str;
      }
    default:
      return str;
  }
};

export function getValue<
  TData,
  TPath extends string,
  TDefault = GetFieldType<TData, TPath>,
>(
  data: TData,
  path: TPath,
  defaultValue?: TDefault,
): GetFieldType<TData, TPath> | TDefault {
  const value = get(data, path) as unknown as GetFieldType<TData, TPath>;
  // This allows the getValue function to return "null" if the value is null
  // and not return the default value. Only "undefined" gets overwritten.
  return value === null ? value : value ?? (defaultValue as TDefault);
}

export function setValue<TData extends object, TPath extends string>(
  data: TData,
  path: TPath,
  value: GetFieldType<TData, TPath>,
) {
  set(data, path, value);
  return data;
}

export const queryParamToString = (
  value: string | string[] | undefined,
): string | undefined => {
  const result = Array.isArray(value) ? value[0] : value;
  return result;
};

export const safeParseInt = <T>(value: T) => {
  const parsedValue =
    typeof value === "string"
      ? parseInt(value)
      : typeof value === "number"
        ? value
        : undefined;
  const returnValue = Number.isNaN(parsedValue) ? undefined : parsedValue;
  return returnValue; // as T extends undefined ? undefined : number - dont do this since it could be NaN
};

export const safeParseFloat = <T>(value: T) => {
  const parsedValue =
    typeof value === "string"
      ? parseFloat(value)
      : typeof value === "number"
        ? value
        : undefined;
  const returnValue = Number.isNaN(parsedValue) ? undefined : parsedValue;
  return returnValue; // as T extends undefined ? undefined : number - dont do this since it could be NaN
};

export const onlyUnique = <T>(value: T, index: number, self: T[]) => {
  return self.indexOf(value) === index;
};

export const normalizeEmail = (identifier: string) => {
  // Get the first two elements only,
  // separated by `@` from user input.
  // eslint-disable-next-line prefer-const
  let [local, domain] = identifier.toLowerCase().trim().split("@");
  // The part before "@" can contain a ","
  // but we remove it on the domain part
  domain = domain?.split(",")[0];
  return `${local}@${domain}`;
};

export const removeUndefinedFromObject = (obj: Record<string, unknown>) => {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== undefined),
  );
};
