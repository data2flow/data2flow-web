import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // k8s 프로브용(웹은 Node라 actuator가 없다)
  route("healthz", "routes/healthz.ts"),
] satisfies RouteConfig;
