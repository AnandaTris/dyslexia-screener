import { describe, it, expect } from "vitest";
import {
  INITIAL_PASSWORD,
  MIN_PASSWORD_LENGTH,
  normaliseEmail,
  isValidEmail,
} from "./studentAuth.js";

describe("INITIAL_PASSWORD", () => {
  it("satisfies Supabase's minimum length", () => {
    // The user first asked for "12345". Supabase rejects anything under 6 with
    // weak_password, which app/login/actions.js already has a message for, so
    // every account creation would have failed at the API.
    expect(INITIAL_PASSWORD.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(INITIAL_PASSWORD).toBe("123456");
  });
});

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it("turns null and undefined into an empty string", () => {
    expect(normaliseEmail(null)).toBe("");
    expect(normaliseEmail(undefined)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isValidEmail("ana@example.com")).toBe(true);
  });

  it("rejects what a therapist actually mistypes", () => {
    for (const bad of ["", "ana", "ana@", "@example.com", "ana example.com", "ana@example"]) {
      expect(isValidEmail(bad), `${bad} should be rejected`).toBe(false);
    }
  });

  it("rejects an address with a space in it", () => {
    expect(isValidEmail("an a@example.com")).toBe(false);
  });
});
