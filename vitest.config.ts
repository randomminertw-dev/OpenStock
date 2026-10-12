import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Next.js preserves JSX for its own compiler; Vitest must compile TSX itself.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
