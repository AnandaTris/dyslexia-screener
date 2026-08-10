import { describe, it, expect } from "vitest";
import { roleOf, isStudent, STUDENT, THERAPIST } from "./roles.js";

describe("roleOf", () => {
  it("reads a student claim out of app_metadata", () => {
    expect(roleOf({ id: "u1", app_metadata: { role: "student" } })).toBe(STUDENT);
  });

  it("treats an account with no claim as a therapist", () => {
    // Every account that existed before this feature has no claim. Defaulting
    // to therapist is what keeps them working, and it grants nothing that
    // signing up at /signup does not already grant.
    expect(roleOf({ id: "u1", app_metadata: {} })).toBe(THERAPIST);
    expect(roleOf({ id: "u1" })).toBe(THERAPIST);
  });

  it("treats an unrecognised claim as a therapist, not as a student", () => {
    // Fail towards the role whose data access RLS already restricts, rather
    // than inventing a third behaviour for a typo.
    expect(roleOf({ app_metadata: { role: "admin" } })).toBe(THERAPIST);
  });

  it("survives a null user", () => {
    expect(roleOf(null)).toBe(THERAPIST);
    expect(roleOf(undefined)).toBe(THERAPIST);
  });

  it("survives app_metadata being a non-object", () => {
    expect(roleOf({ app_metadata: "student" })).toBe(THERAPIST);
  });
});

describe("isStudent", () => {
  it("is true only for the student claim", () => {
    expect(isStudent({ app_metadata: { role: "student" } })).toBe(true);
    expect(isStudent({ app_metadata: { role: "therapist" } })).toBe(false);
    expect(isStudent(null)).toBe(false);
  });
});
