import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSIONS, OPERATOR_PERMISSIONS, VIEWER_PERMISSIONS } from "../../../test/roles";
import { inAdmin, railFor, topMenu } from "../rail";

describe("[DSH-07.02] 목업 화면 틀 — 상단 메뉴와 왼쪽 막대", () => {
  it("상단은 업무 메뉴와 관리 묶음으로 나뉘고, 임시 비밀번호 상태면 둘 다 비어 있다", () => {
    const { main, admin } = topMenu(ADMIN_PERMISSIONS, false);
    expect(main.map((m) => m.key)).toContain("devices");
    expect(admin[0].path).toBe("/admin/members");
    expect(inAdmin(admin, "/admin/roles")).toBe(true);
    expect(inAdmin(admin, "/devices")).toBe(false);
    expect(topMenu(ADMIN_PERMISSIONS, true)).toEqual({ main: [], admin: [] });
  });

  it("관리 화면은 관리 항목을, 기기 화면은 기기 하위 화면을 보여 주고 가장 긴 경로가 현재 항목이다", () => {
    const admin = railFor("/admin/roles", ADMIN_PERMISSIONS, false)!;
    expect(admin.title).toBe("nav.admin");
    expect(admin.items.map((i) => i.path)).toContain("/admin/branding");
    expect(admin.current).toBe("/admin/roles");
    const devices = railFor("/devices/pending", ADMIN_PERMISSIONS, false)!;
    expect(devices.title).toBe("nav.devices");
    expect(devices.current).toBe("/devices/pending");
    expect(railFor("/devices/42", ADMIN_PERMISSIONS, false)!.current).toBe("/devices");
    expect(railFor("/alarms/stats", ADMIN_PERMISSIONS, false)!.current).toBe("/alarms/stats");
  });

  it("권한 없는 항목은 숨기고, 막대가 없는 메뉴(홈·대시보드)·잠긴 상태·항목 1개 이하는 막대를 그리지 않는다", () => {
    const viewer = railFor("/control/commands", VIEWER_PERMISSIONS, false);
    expect(viewer).toBeNull();
    const operator = railFor("/automation/flows", OPERATOR_PERMISSIONS, false);
    expect(operator?.items.map((i) => i.path) ?? []).not.toContain("/automation/sink-connections");
    expect(railFor("/", ADMIN_PERMISSIONS, false)).toBeNull();
    expect(railFor("/dashboards", ADMIN_PERMISSIONS, false)).toBeNull();
    expect(railFor("/devices", ADMIN_PERMISSIONS, true)).toBeNull();
    expect(railFor("/me", ADMIN_PERMISSIONS, false)).toBeNull();
    expect(railFor("/automation/flows/new", ADMIN_PERMISSIONS, false)).toBeNull();
    expect(railFor("/automation/flows", ADMIN_PERMISSIONS, false)).not.toBeNull();
  });
});
