import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts"
  ],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  // Bundle workspace packages so the API dist is self-contained:
  // - @ai-aggregate/shared: types/constants (inlined at compile time)
  // - @ai-aggregate/ai-adapters: runtime code (bundled into dist)
  noExternal: [/@ai-aggregate/],
});
