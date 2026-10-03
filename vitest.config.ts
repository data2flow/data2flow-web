import { defineConfig } from "vitest/config";

const alias = { "~": new URL("./app", import.meta.url).pathname };

/**
 * 두 프로젝트(design/testing/frontend.md §2): server(node — BFF, loader/action, SSR 통합) / client(jsdom — 화면 부품).
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          include: ["app/**/*.test.ts"],
          setupFiles: ["test/setup.server.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          // SSR 통합(실제 라우트 + 가짜 gateway). 파일마다 Vite 개발 서버를 띄우고 React Router 타입 생성기가
          // 같은 .react-router 폴더에 쓰므로, 파일끼리 겹치지 않게 차례로 돌린다
          name: "ssr",
          environment: "node",
          include: ["test/**/*.test.ts"],
          setupFiles: ["test/setup.server.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "client",
          environment: "jsdom",
          include: ["app/**/*.test.tsx"],
          setupFiles: ["test/setup.client.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}"],
      // 라우트 화면·진입점은 SSR 통합 테스트(test/)와 E2E에서 본다(frontend.md §4: lib·components·bff 측정)
      exclude: ["app/**/*.test.*", "app/**/__tests__/**", "app/root.tsx", "app/entry.server.tsx", "app/routes/**", "app/routes.ts", "app/**/+types/**"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
