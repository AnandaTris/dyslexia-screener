// Runs the rag-service virtualenv interpreter, whichever OS you are on, with
// the arguments given. package.json used to hardcode `.venv\Scripts\python.exe`,
// so `npm run dev:all` started the web half and silently lost the rag half on
// macOS and Linux — the failure looked like "the assistant is offline".
//
// Expects to be run from rag-service/, because config.py reads .env relative to
// the working directory. `npm run dev:rag` cds there first.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const CANDIDATES = [
  path.join(".venv", "bin", "python"), // macOS, Linux
  path.join(".venv", "Scripts", "python.exe"), // Windows
];

const found = CANDIDATES.find((candidate) => existsSync(candidate));

if (!found) {
  console.error(
    `No virtualenv found in ${process.cwd()}\n` +
      `Looked for: ${CANDIDATES.join("  and  ")}\n\n` +
      `Create it with:\n` +
      `  cd rag-service\n` +
      `  python -m venv .venv\n` +
      `  .venv/bin/python -m pip install -r requirements.txt\n\n` +
      `See WORKFLOW.md, first-time setup step 5.`
  );
  process.exit(1);
}

const child = spawn(path.resolve(found), process.argv.slice(2), { stdio: "inherit" });

// `concurrently -k` stops the sibling process by signalling this one; forward it
// so uvicorn shuts down instead of surviving as an orphan holding port 8000.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (err) => {
  console.error(`Could not start ${found}: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
