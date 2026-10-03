import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}"],
      // 라우트 화면·진입점은 컴포넌트·E2E 테스트에서 본다
      exclude: ["app/**/*.test.*", "app/root.tsx", "app/routes/**", "app/**/+types/**"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
