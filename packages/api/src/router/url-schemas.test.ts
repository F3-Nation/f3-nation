import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import {
  facebookUrlSchema,
  instagramUrlSchema,
  twitterUrlSchema,
  websiteUrlSchema,
} from "@acme/validators";

const pass = (schema: ZodType, value: string) =>
  expect(schema.safeParse(value).success, `expected "${value}" to pass`).toBe(
    true,
  );

const fail = (schema: ZodType, value: string) =>
  expect(schema.safeParse(value).success, `expected "${value}" to fail`).toBe(
    false,
  );

describe("websiteUrlSchema", () => {
  it("accepts empty string", () => pass(websiteUrlSchema, ""));

  it("accepts valid https URLs", () => {
    pass(websiteUrlSchema, "https://example.com");
    pass(websiteUrlSchema, "https://www.example.com");
    pass(websiteUrlSchema, "https://example.co.uk");
    pass(websiteUrlSchema, "https://sub.domain.example.com/path");
    pass(websiteUrlSchema, "https://my-site.dev");
  });

  it("accepts valid http URLs", () => {
    pass(websiteUrlSchema, "http://example.com");
  });

  it("rejects incomplete or invalid domains", () => {
    fail(websiteUrlSchema, "https://bob");
    fail(websiteUrlSchema, "https://localhost");
    fail(websiteUrlSchema, "https://example");
    fail(websiteUrlSchema, "https://example.");
    fail(websiteUrlSchema, "https://example.1");
  });

  it("rejects hostnames starting with dot", () => {
    fail(websiteUrlSchema, "https://.example.com");
  });

  it("rejects non-http protocols", () => {
    fail(websiteUrlSchema, "ftp://example.com");
    fail(websiteUrlSchema, "ht://bob");
  });

  it("rejects non-URL strings", () => {
    fail(websiteUrlSchema, "not a url");
    fail(websiteUrlSchema, "example.com");
  });
});

describe("facebookUrlSchema", () => {
  it("accepts empty string", () => pass(facebookUrlSchema, ""));

  it("accepts valid Facebook profile/page URLs", () => {
    pass(facebookUrlSchema, "https://facebook.com/mypage");
    pass(facebookUrlSchema, "https://www.facebook.com/mypage");
    pass(facebookUrlSchema, "https://m.facebook.com/mypage");
    pass(facebookUrlSchema, "https://facebook.com/profile.php?id=12345");
  });

  it("accepts Facebook homepage", () => {
    pass(facebookUrlSchema, "https://facebook.com");
    pass(facebookUrlSchema, "https://www.facebook.com/");
    pass(facebookUrlSchema, "https://m.facebook.com/");
  });

  it("rejects non-Facebook URLs", () => {
    fail(facebookUrlSchema, "https://example.com");
    fail(facebookUrlSchema, "https://notfacebook.com/mypage");
  });

  it("rejects share/sharer links", () => {
    fail(
      facebookUrlSchema,
      "https://facebook.com/sharer/sharer.php?u=https://example.com",
    );
    fail(facebookUrlSchema, "https://facebook.com/share?url=https://x.com");
    fail(facebookUrlSchema, "https://www.facebook.com/share/17edENZtXt/");
  });

  it("rejects incomplete or invalid domains", () => {
    fail(facebookUrlSchema, "https://facebook");
    fail(facebookUrlSchema, "https://www.facebook");
  });

  it("rejects non-http protocols", () => {
    fail(facebookUrlSchema, "ftp://facebook.com/mypage");
  });

  it("rejects non-URL strings", () => {
    fail(facebookUrlSchema, "facebook.com/mypage");
    fail(facebookUrlSchema, "@mypage");
  });
});

describe("instagramUrlSchema", () => {
  it("accepts empty string", () => pass(instagramUrlSchema, ""));

  it("accepts valid Instagram profile URLs", () => {
    pass(instagramUrlSchema, "https://instagram.com/myhandle");
    pass(instagramUrlSchema, "https://www.instagram.com/myhandle");
  });

  it("accepts Instagram homepage", () => {
    pass(instagramUrlSchema, "https://instagram.com");
    pass(instagramUrlSchema, "https://www.instagram.com/");
  });

  it("rejects non-Instagram URLs", () => {
    fail(instagramUrlSchema, "https://example.com");
    fail(instagramUrlSchema, "https://notinstagram.com/myhandle");
  });

  it("rejects reel/post/explore/stories links", () => {
    fail(instagramUrlSchema, "https://instagram.com/reel/abc123");
    fail(instagramUrlSchema, "https://www.instagram.com/reel/abc123");
    fail(instagramUrlSchema, "https://instagram.com/p/abc123");
    fail(instagramUrlSchema, "https://instagram.com/explore");
    fail(instagramUrlSchema, "https://instagram.com/stories/user/123");
  });

  it("rejects incomplete or invalid domains", () => {
    fail(instagramUrlSchema, "https://instagram");
    fail(instagramUrlSchema, "https://www.instagram");
  });

  it("rejects non-URL strings", () => {
    fail(instagramUrlSchema, "instagram.com/myhandle");
    fail(instagramUrlSchema, "@myhandle");
  });
});

describe("twitterUrlSchema", () => {
  it("accepts empty string", () => pass(twitterUrlSchema, ""));

  it("accepts valid Twitter/X profile URLs", () => {
    pass(twitterUrlSchema, "https://twitter.com/myhandle");
    pass(twitterUrlSchema, "https://www.twitter.com/myhandle");
    pass(twitterUrlSchema, "https://x.com/myhandle");
    pass(twitterUrlSchema, "https://www.x.com/myhandle");
  });

  it("accepts Twitter/X homepage", () => {
    pass(twitterUrlSchema, "https://twitter.com");
    pass(twitterUrlSchema, "https://x.com/");
  });

  it("rejects non-Twitter/X URLs", () => {
    fail(twitterUrlSchema, "https://example.com");
    fail(twitterUrlSchema, "https://nottwitter.com/myhandle");
    fail(twitterUrlSchema, "https://notx.com/myhandle");
  });

  it("rejects intent/status links", () => {
    fail(twitterUrlSchema, "https://twitter.com/intent/tweet?text=hello");
    fail(twitterUrlSchema, "https://x.com/user/status/12345");
    fail(twitterUrlSchema, "https://twitter.com/user/status/12345");
  });

  it("rejects incomplete or invalid domains", () => {
    fail(twitterUrlSchema, "https://x");
    fail(twitterUrlSchema, "https://twitter");
  });

  it("rejects non-URL strings", () => {
    fail(twitterUrlSchema, "twitter.com/myhandle");
    fail(twitterUrlSchema, "@myhandle");
  });
});
