import { defineConfig } from "vitest/config";

const requestedDuration = Number(process.env.FUZZ_DURATION_MS);
const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
  ? requestedDuration
  : 60_000;

export default defineConfig({
  test: {
    environment: "node",
    include: ["fuzz/**/*.fuzz.js"],
    exclude: ["node_modules/**", ".next/**"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // A duration campaign divides this budget between the selected properties.
    // The extra minute leaves time for fast-check to shrink and report a failure.
    testTimeout: duration + 60_000,
  },
});
