/**
 * 환경 기준 화면 부품: 프로필 편집기(UI-CMP-03, TC-CMP-007 즉시 검사), 목록 표(UI-CMP-01, TC-CMP-016), 기준값 표(UI-CMP-02).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../../test/render";
import { emptyDraft } from "../../model/profile-form";
import type { ProfileVersion } from "../../model/types";
import { ProfileEditor } from "../profile-editor";
import { CriteriaView, ProfileTable } from "../profile-views";

const metrics = [
  { key: "co2", displayName: "이산화탄소", unit: "ppm" },
  { key: "pm2_5", displayName: "초미세먼지", unit: "μg/m³" },
];

describe("CMP-01.01 UI-CMP-03 프로필 편집기", () => {
  it("TC-CMP-007 고친 칸의 오류를 바로 보이고, 오류가 있으면 [저장]을 막는다", async () => {
    await renderRoute(<ProfileEditor mode="create" initial={emptyDraft()} metrics={metrics} cancelTo="/compliance/profiles" />);
    const save = await screen.findByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    expect(screen.queryByText("이름을 입력하세요")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("이름"), "우리 기준");
    await userEvent.type(screen.getByLabelText("출처"), "내부 지침");
    await userEvent.type(screen.getByLabelText("기준일"), "2026-10-01");
    await userEvent.selectOptions(screen.getByLabelText("항목"), "co2");
    expect(screen.getByLabelText("단위")).toHaveValue("ppm");

    await userEvent.type(screen.getAllByLabelText("하한")[0], "900");
    await userEvent.type(screen.getAllByLabelText("상한")[0], "800");
    expect(screen.getByText("하한이 상한보다 클 수 없습니다")).toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.clear(screen.getAllByLabelText("하한")[0]);
    expect(screen.queryByText("하한이 상한보다 클 수 없습니다")).not.toBeInTheDocument();
    expect(save).toBeEnabled();
    const payload = JSON.parse((document.querySelector('input[name="payload"]') as HTMLInputElement).value);
    expect(payload).toMatchObject({ name: "우리 기준", metrics: [{ metricKey: "co2", upper: "800", unit: "ppm" }] });

    await userEvent.type(screen.getByLabelText("출처 링크"), "http://x");
    expect(screen.getByText("https:// 로 시작하는 주소여야 합니다")).toBeInTheDocument();
  });

  it("새 버전 저장은 변경 메모가 필수, 서버 필드 오류는 늘 보인다", async () => {
    const initial = { ...emptyDraft(), sourceTitle: "별표 2", effectiveDate: "2025-01-01", metrics: [{ ...emptyDraft().metrics[0], metricKey: "co2", unit: "ppm", upper: "1000" }] };
    await renderRoute(<ProfileEditor mode="version" initial={initial} metrics={metrics} cancelTo="/x" baseVersion={3} serverErrors={{ "metrics.0.upper": "threshold" }} />);
    expect(await screen.findByRole("button", { name: "새 버전으로 저장" })).toBeDisabled();
    expect(screen.getByText("기준값을 확인하세요")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("변경 메모"), "기준 강화");
    expect(screen.getByRole("button", { name: "새 버전으로 저장" })).toBeEnabled();
    expect(document.querySelector('input[name="baseVersion"]')).toHaveValue("3");
  });
});

describe("UI-CMP-01·02 목록·기준값 표", () => {
  it("TC-CMP-016 목록은 이름 링크·구분·적용 수, [복제해 수정]은 관리 권한에서만", async () => {
    const profiles = [{ profileId: "1", kind: "SYSTEM" as const, code: "KR", name: "국내법", archived: false, currentVersionNo: 1, sourceTitle: "별표 2", effectiveDate: "2025-01-01", applicationCount: 3, updatedAt: "2026-10-01T00:00:00Z" }];
    const { unmount } = await renderRoute(<ProfileTable profiles={profiles} timezone="Asia/Seoul" canAdmin={false} onClone={() => {}} />);
    const row = (await screen.findByText("국내법")).closest("tr")!;
    expect(within(row).getByRole("link", { name: "국내법" })).toHaveAttribute("href", "/compliance/profiles/1");
    expect(within(row).getByText("시스템")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "복제해 수정" })).not.toBeInTheDocument();
    unmount();
    await renderRoute(<ProfileTable profiles={profiles} timezone="Asia/Seoul" canAdmin onClone={() => {}} />);
    expect(await screen.findByRole("button", { name: "복제해 수정" })).toBeInTheDocument();
  });

  it("기준값 표는 시설 유형·권고 표시·등급을 보인다", async () => {
    const version = {
      versionNo: 1, sourceTitle: "별표 2", sourceUrl: null, effectiveDate: "2025-01-01", description: null, streak: { days: 7, dailyRatio: 90 }, facilityTypeRequired: true, facilityTypes: ["GENERAL"], changeNote: null, locked: true, coverage: [], createdBy: null, createdAt: "2026-10-01T00:00:00Z",
      metrics: [
        { metricKey: "co2", facilityType: "GENERAL", evalWindow: "HOUR_1", lower: null, upper: 1000, inclusive: true, unit: "ppm", requirement: "LIMIT", note: null, bands: [{ name: "기준", lower: null, upper: 1000, isBase: true }, { name: "우수", lower: null, upper: 800, isBase: false }] },
        { metricKey: "tvoc", facilityType: "GENERAL", evalWindow: "HOUR_1", lower: null, upper: 500, inclusive: true, unit: "μg/m³", requirement: "RECOMMENDED", note: null, bands: [] },
      ],
    } as unknown as ProfileVersion;
    await renderRoute(<CriteriaView version={version} metricNames={{ co2: "이산화탄소" }} />);
    expect(await screen.findByText("7일 연속, 하루 90% 이상")).toBeInTheDocument();
    const co2 = screen.getByText("이산화탄소").closest("tr")!;
    expect(within(co2).getByText("일반 다중이용시설")).toBeInTheDocument();
    expect(within(co2).getByText("기준 ≤ 1000 · 우수 ≤ 800")).toBeInTheDocument();
    expect(within(screen.getByText("tvoc").closest("tr")!).getByText("권고")).toBeInTheDocument();
  });
});
