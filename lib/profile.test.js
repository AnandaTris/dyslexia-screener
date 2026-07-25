import { describe, it, expect } from "vitest";
import { deriveProfile } from "./profile.js";

describe("deriveProfile", () => {
  it("returns null when there are no indicators", () => {
    expect(deriveProfile([])).toBeNull();
    expect(deriveProfile(undefined)).toBeNull();
  });

  it("weights categories into profiles and picks the dominant one", () => {
    const indicators = [
      { category: "reversal", strength: "strong" },   // visual_spatial +3
      { category: "formation", strength: "moderate" },// visual_spatial +2
      { category: "phonetic_spelling", strength: "weak" }, // phonological +1
    ];
    const p = deriveProfile(indicators);
    expect(p.primary_label).toBe("visual_spatial");
    expect(p.weights.visual_spatial).toBe(5);
    expect(p.weights.phonological).toBe(1);
    expect(p.weights.surface).toBe(0);
  });

  it("counts homophone toward both phonological and surface", () => {
    const p = deriveProfile([{ category: "homophone", strength: "moderate" }]);
    expect(p.weights.phonological).toBe(2);
    expect(p.weights.surface).toBe(2);
  });

  it("returns null when indicators map to no known category", () => {
    expect(deriveProfile([{ category: "nonsense", strength: "weak" }])).toBeNull();
  });
});
