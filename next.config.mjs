/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    },
    // Keep the NLP stack out of the webpack bundle:
    //   - onnxruntime-node loads a native binary at runtime, and bundling it
    //     breaks the require path Transformers.js uses to find it.
    //   - dictionary-en reads its Hunspell .aff/.dic files at import time via
    //     `fs.readFile(new URL(..., import.meta.url))`. Bundled, the URL no
    //     longer resolves against the package directory and the read throws.
    serverComponentsExternalPackages: [
      "onnxruntime-node",
      "@huggingface/transformers",
      "dictionary-en",
      "nspell",
      "cmu-pronouncing-dictionary"
    ]
  }
};

export default nextConfig;
