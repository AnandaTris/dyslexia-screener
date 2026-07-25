// Downloads and caches the grammar-correction weights, and smoke-tests the
// full analysis pipeline.
//
// Run once after cloning: `npm run warm:nlp`. Without it the first request that
// hits /api/analyze pays for a ~70 MB download inside the request timeout.

import { analyzeWriting } from "../lib/nlp/analyze.js";
import { gecConfig, loadCorrector } from "../lib/nlp/gec.js";

const SAMPLE =
  "Last nite I went to the beech with my frend. We had enuf time to bild a sand casel. Their was to much wind so we went hom.";

const config = gecConfig();

if (!config.enabled) {
  console.log("NLP_GEC=off — neural layer disabled, nothing to warm.");
  process.exit(0);
}

console.log(`Fetching ${config.model} (dtype=${config.dtype})…`);
console.log("First run downloads roughly 70 MB and caches it on disk.\n");

const started = Date.now();
const corrector = await loadCorrector();

if (!corrector) {
  console.error("Could not load the model. The analyser will still run on its");
  console.error("lexicon and phonology layers, but context-dependent errors");
  console.error("(their/there, to/too) will not be detected.");
  process.exit(1);
}

console.log(`Model ready in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);
console.log("Smoke test:\n");

const report = await analyzeWriting(SAMPLE, { transcribed: false });

console.log(report.summary);
console.log(`\nProfile: ${report.profile.label} (confidence ${report.profile.confidence})`);
console.log(`Layers:  ${JSON.stringify(report.pipeline.layers)}\n`);

for (const error of report.errors) {
  console.log(
    `  ${error.produced.padEnd(12)} -> ${String(error.target).padEnd(12)}` +
      ` ${error.category}/${error.subtype}  (via ${error.source})`,
  );
}
