/**
 * DSH-05.04 데이터 탐색 주석 목록: 알람 주석은 차트의 빨간 세로선과 같은 기호·색.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../../test/render";
import { AnnotationList } from "../annotations";

describe("[DSH-05.04] 주석 목록", () => {
  it("TC-DSH-060 알람 주석은 ▲ 기호와 위험 색, 사용자 주석은 기본 색", async () => {
    await renderRoute(
      <AnnotationList
        items={[
          { id: "1", timeFrom: "2026-10-03T01:10:00Z", timeTo: null, deviceId: "17", spaceId: null, type: "ALARM", title: "고온", createdBy: null },
          { id: "2", timeFrom: "2026-10-03T01:20:00Z", timeTo: null, deviceId: "17", spaceId: null, type: "USER", title: "필터 교체", createdBy: "7" },
        ]}
        timezone="UTC"
        canEdit={false}
      />,
    );
    const alarm = (await screen.findByText("고온")).parentElement!.querySelector("span")!;
    expect(alarm).toHaveTextContent("▲");
    expect(alarm.className).toContain("bad");
    expect(screen.getByText("필터 교체").parentElement!.querySelector("span")!).not.toHaveTextContent("▲");
  });
});
