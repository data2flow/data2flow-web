/** `/m` → 작업 탭(UI-DSH-14 기본 탭) */
import { redirect } from "react-router";

export function loader() {
  return redirect("/m/work-orders");
}
