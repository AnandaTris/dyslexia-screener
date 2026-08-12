import { describe, expect, it } from "vitest";
import { formatDuration, parseCliArgs, parseDuration } from "./run-fuzz.mjs";

describe("fuzz runner CLI", () => {
  it("parses the 24-hour campaign duration", () => {
    expect(parseDuration("24h")).toBe(86_400_000);
    expect(formatDuration(86_400_000)).toBe("24h");
  });

  it("switches from the default duration to a fixed run count", () => {
    expect(parseCliArgs(["--runs", "500", "--target", "tokenizer-offsets"])).toMatchObject({
      durationMs: null,
      runs: 500,
      target: "tokenizer-offsets",
    });
  });

  it("accepts exact failure replay controls", () => {
    expect(
      parseCliArgs(["--target=character-alignment", "--seed=-42", "--path=0:1:2"]),
    ).toMatchObject({
      durationMs: null,
      runs: 1,
      target: "character-alignment",
      seed: -42,
      path: "0:1:2",
    });
  });

  it("rejects ambiguous or incomplete campaigns", () => {
    expect(() => parseCliArgs(["--duration", "1h", "--runs", "100"])).toThrow(
      /either --duration or --runs/,
    );
    expect(() => parseCliArgs(["--path", "0:1"])).toThrow(/requires both --target and --seed/);
    expect(() =>
      parseCliArgs([
        "--path", "0:1", "--target", "tokenizer-offsets", "--seed", "1", "--runs", "10",
      ]),
    ).toThrow(/cannot be combined/);
    expect(() => parseDuration("tomorrow")).toThrow(/Invalid duration/);
  });
});
