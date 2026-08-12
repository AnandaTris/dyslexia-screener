import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const DEFAULT_DURATION_MS = 60_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const HELP = `Usage: npm run fuzz -- [options]

Options:
  --duration <Nms|Ns|Nm|Nh>  Run for a wall-clock budget (default: 60s)
  --runs <N>                 Run N generated cases per selected target
  --target <name>            Run one named target instead of the full suite
  --seed <integer>           Reuse a fast-check seed
  --path <counterexample>    Reuse a fast-check shrink path (requires --target and --seed)
  --help                     Show this help

Examples:
  npm run fuzz:smoke
  npm run fuzz -- --duration 10m
  npm run fuzz:24h
  npm run fuzz -- --target character-alignment --seed 123 --path "0:1:2"
`;

export function parseDuration(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use values such as 500ms, 30s, 10m, or 24h.`);
  }

  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  const milliseconds = Math.round(amount * multiplier);

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > MAX_DURATION_MS) {
    throw new Error("Duration must be between 1ms and 7 days.");
  }
  return milliseconds;
}

function parseInteger(value, label, { positive = false } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (positive && parsed < 1)) {
    throw new Error(`${label} must be ${positive ? "a positive" : "an"} integer.`);
  }
  return parsed;
}

function readOption(argv, index, name) {
  const arg = argv[index];
  const prefix = `${name}=`;
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), next: index };
  if (arg === name && argv[index + 1] !== undefined) {
    return { value: argv[index + 1], next: index + 1 };
  }
  if (arg === name) throw new Error(`${name} requires a value.`);
  return null;
}

export function parseCliArgs(argv) {
  const options = {
    durationMs: DEFAULT_DURATION_MS,
    runs: null,
    target: null,
    seed: null,
    path: null,
    help: false,
  };
  let durationWasSet = false;
  let runsWasSet = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    const duration = readOption(argv, index, "--duration");
    if (duration) {
      options.durationMs = parseDuration(duration.value);
      durationWasSet = true;
      index = duration.next;
      continue;
    }

    const runs = readOption(argv, index, "--runs");
    if (runs) {
      options.runs = parseInteger(runs.value, "--runs", { positive: true });
      runsWasSet = true;
      index = runs.next;
      continue;
    }

    const target = readOption(argv, index, "--target");
    if (target) {
      if (!target.value.trim()) throw new Error("--target cannot be empty.");
      options.target = target.value;
      index = target.next;
      continue;
    }

    const seed = readOption(argv, index, "--seed");
    if (seed) {
      options.seed = parseInteger(seed.value, "--seed");
      index = seed.next;
      continue;
    }

    const path = readOption(argv, index, "--path");
    if (path) {
      if (!path.value.trim()) throw new Error("--path cannot be empty.");
      options.path = path.value;
      index = path.next;
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  if (durationWasSet && runsWasSet) {
    throw new Error("Choose either --duration or --runs, not both.");
  }
  if (runsWasSet) options.durationMs = null;
  if (options.path !== null && (options.target === null || options.seed === null)) {
    throw new Error("--path requires both --target and --seed so the failure can be replayed exactly.");
  }
  if (options.path !== null && (durationWasSet || runsWasSet)) {
    throw new Error("--path replays one minimized counterexample and cannot be combined with --duration or --runs.");
  }
  if (options.path !== null) {
    options.durationMs = null;
    options.runs = 1;
  }

  return options;
}

export function formatDuration(milliseconds) {
  if (milliseconds % 3_600_000 === 0) return `${milliseconds / 3_600_000}h`;
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000}m`;
  if (milliseconds % 1_000 === 0) return `${milliseconds / 1_000}s`;
  return `${milliseconds}ms`;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error("\n" + HELP);
    return 2;
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const mode = options.durationMs === null
    ? `${options.runs} cases per target`
    : `${formatDuration(options.durationMs)} total wall-clock budget`;
  console.log(`Starting robustness fuzzing: ${mode}.`);
  console.log(`Target: ${options.target ?? "all"}; seed: ${options.seed ?? "random"}.`);

  const environment = {
    ...process.env,
    FUZZ_DURATION_MS: options.durationMs === null ? "" : String(options.durationMs),
    FUZZ_RUNS: options.runs === null ? "" : String(options.runs),
    FUZZ_TARGET: options.target ?? "",
    FUZZ_SEED: options.seed === null ? "" : String(options.seed),
    FUZZ_PATH: options.path ?? "",
  };
  const vitestEntry = resolve("node_modules/vitest/vitest.mjs");
  const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", "--config", "vitest.fuzz.config.mjs"],
    { cwd: process.cwd(), env: environment, stdio: "inherit" },
  );

  if (result.error) {
    console.error(`Unable to start Vitest: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`Fuzzing stopped by ${result.signal}.`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
