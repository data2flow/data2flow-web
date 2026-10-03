import { useTranslation } from "react-i18next";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "data2flow" }];
}

export default function Home() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">{t("app.name")}</h1>
      <p className="text-lg">{t("app.tagline")}</p>
      <p className="text-sm text-gray-500">{t("app.preparing")}</p>
    </main>
  );
}
