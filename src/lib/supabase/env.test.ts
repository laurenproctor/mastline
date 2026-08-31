import { describe, expect, it } from "vitest";
import { resumableUploadEndpoint } from "./env";

/**
 * The upload endpoint is derived, never written down.
 *
 * A project id in the source is a project id that will one day be the wrong
 * one: the preview deployment uploading into production is not a mistake
 * anybody notices from a code review.
 */
describe("the resumable upload endpoint", () => {
  it("uses the direct storage hostname for a hosted project", () => {
    expect(resumableUploadEndpoint("https://abcdefghijklmnop.supabase.co")).toBe(
      "https://abcdefghijklmnop.storage.supabase.co/storage/v1/upload/resumable",
    );
  });

  it("keeps the top level domain the project actually uses", () => {
    expect(resumableUploadEndpoint("https://project123.supabase.in")).toBe(
      "https://project123.storage.supabase.in/storage/v1/upload/resumable",
    );
  });

  it("leaves a local stack where it is", () => {
    // There is no separate storage host in the local containers.
    expect(resumableUploadEndpoint("http://127.0.0.1:55321")).toBe(
      "http://127.0.0.1:55321/storage/v1/upload/resumable",
    );
  });

  it("leaves a self-hosted instance where it is, path and all", () => {
    expect(resumableUploadEndpoint("https://storage.example.test/supabase/")).toBe(
      "https://storage.example.test/supabase/storage/v1/upload/resumable",
    );
  });

  it("refuses something that is not a URL", () => {
    expect(() => resumableUploadEndpoint("not-a-url")).toThrow(/not a URL/);
  });
});
