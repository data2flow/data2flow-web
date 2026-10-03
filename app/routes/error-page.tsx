import { ErrorView } from "~/components/error-view";
import type { Route } from "./+types/error-page";

/** UI-IAM-13 오류·접근 안내 페이지(`/error/401` 등) */
export function loader({ params }: Route.LoaderArgs) {
  const status = Number(params.status);
  return { status: [401, 403, 404, 503].includes(status) ? status : 404 };
}

export function meta() {
  return [{ title: "data2flow" }];
}

export default function ErrorPage({ loaderData }: Route.ComponentProps) {
  return <ErrorView status={loaderData.status} />;
}
