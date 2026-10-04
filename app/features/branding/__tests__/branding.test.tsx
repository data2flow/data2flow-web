/**
 * UI-DSH-13 브랜딩 설정(DSH-13.01): 대비 경고와 [그래도 저장](TC-DSH-114, AT-DSH-14.2), 자산 검사(AT-DSH-14.3), 미리 보기, 입력 검증
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { BrandingForm, type BrandingApi } from "../components/branding-form";
import { brandingBody, checkAsset, contrastCheck, formOf, validateBranding, type Branding } from "../model/branding";

const initial: Branding = { primaryColor: "#206BC4", mailSenderName: "data2flow 운영팀", publicTheme: "AUTO", logoLightUrl: "/api/v1/core/public/branding/assets/5", version: 2 };

function api(overrides: Partial<BrandingApi> = {}) {
  return {
    save: vi.fn(async (body: Record<string, unknown>) => ({ ok: true as const, data: { ...initial, ...(body as object), version: 3 } as Branding })),
    upload: vi.fn(async () => ({ ok: true as const, data: { assetId: "12", url: "/api/v1/core/public/branding/assets/12" } })),
    ...overrides,
  };
}

describe("DSH-13.01 브랜딩 설정", () => {
  it("TC-DSH-114 AT-DSH-14.2: #FFFF00이면 '대비가 낮습니다(1.1:1, 기준 4.5:1)' 경고, [그래도 저장]을 눌러야 저장(contrastWarningAcked)", async () => {
    const a = api();
    await renderRoute(<BrandingForm initial={initial} api={a} />);
    const color = await screen.findByLabelText("주 색상(HEX)");
    await userEvent.clear(color);
    await userEvent.type(color, "#FFFF00");
    expect(screen.getByRole("status")).toHaveTextContent("대비가 낮습니다(1.1:1, 기준 4.5:1)");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(a.save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "그래도 저장" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(a.save).mock.calls[0][0]).toMatchObject({ primaryColor: "#FFFF00", contrastWarningAcked: true, baseVersion: 2, mailSenderName: "data2flow 운영팀" });
    expect(await screen.findByText("저장했습니다")).toBeInTheDocument();
  });

  it("AT-DSH-14.1: 대비가 충분하면 바로 저장, 로고 올리기 → 자산 id가 본문에, 미리 보기(웹·로그인·메일)", async () => {
    const a = api();
    await renderRoute(<BrandingForm initial={initial} api={a} />);
    const color = await screen.findByLabelText("주 색상(HEX)");
    await userEvent.clear(color);
    await userEvent.type(color, "#0055AA");
    expect(screen.getByText(/흰 배경 대비 7\.\d:1/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("로고(밝은 배경용)"), new File(["png"], "logo.png", { type: "image/png" }));
    await waitFor(() => expect(a.upload).toHaveBeenCalledWith("LOGO_LIGHT", expect.any(File)));
    expect(screen.getByTestId("branding-preview").querySelector("img")).toHaveAttribute("src", "/branding/assets/12");
    await userEvent.type(screen.getByLabelText("로그인 화면 문구(≤100자)"), "환영합니다");
    await userEvent.click(screen.getByRole("tab", { name: "로그인" }));
    expect(screen.getByTestId("branding-preview")).toHaveTextContent("환영합니다");
    await userEvent.type(screen.getByLabelText("메일 서명(≤500자)"), "운영팀 드림");
    await userEvent.click(screen.getByRole("tab", { name: "메일" }));
    expect(screen.getByTestId("branding-preview")).toHaveTextContent("보낸 사람: data2flow 운영팀");
    await userEvent.selectOptions(screen.getByLabelText("공개 화면 테마"), "DARK");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(a.save).toHaveBeenCalled());
    expect(vi.mocked(a.save).mock.calls[0][0]).toMatchObject({ primaryColor: "#0055AA", logoLightAssetId: "12", loginMessage: "환영합니다", publicTheme: "DARK", contrastWarningAcked: false });
  });

  it("AT-DSH-14.3: 스크립트가 든 SVG·1MB 초과·형식 오류는 올리지 않는다, 서버 거부·동시 수정 409 안내", async () => {
    const a = api({
      upload: vi.fn(async () => ({ ok: false as const, code: "BRANDING_ASSET_INVALID", message: "" })),
      save: vi.fn(async () => ({ ok: false as const, status: 409, code: "VERSION_CONFLICT", message: "" })),
    });
    await renderRoute(<BrandingForm initial={null} api={a} />);
    await userEvent.upload(await screen.findByLabelText("로고(어두운 배경용)"), new File(['<svg><script>alert(1)</script></svg>'], "x.svg", { type: "image/svg+xml" }));
    expect(await screen.findByText("SVG에 스크립트나 외부 참조가 있어 쓸 수 없습니다")).toBeInTheDocument();
    expect(a.upload).not.toHaveBeenCalled();
    await userEvent.upload(screen.getByLabelText("파비콘"), new File(["x"], "fav.png", { type: "image/png" }));
    expect(await screen.findByText("로고는 1MB 이하 PNG 또는 안전한 SVG여야 합니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("다른 관리자가 먼저 바꿨습니다. 새로고침 뒤 다시 저장하세요.")).toBeInTheDocument();
    const color = screen.getByLabelText("주 색상(HEX)");
    await userEvent.clear(color);
    await userEvent.type(color, "blue");
    expect(screen.getByText("HEX 6자리로 입력하세요(예: #0055AA)")).toBeInTheDocument();
  });

  it("모델: 파일 종류·크기·SVG 안전성, 글자 수, 본문", () => {
    expect(checkAsset("LOGO_LIGHT", { name: "a.svg", type: "image/svg+xml", size: 10 }, '<svg><a href="https://x"/></svg>')).toEqual({ ok: false, reason: "UNSAFE_SVG" });
    expect(checkAsset("LOGO_LIGHT", { name: "a.svg", type: "", size: 10 }, '<svg onload="x()"></svg>')).toEqual({ ok: false, reason: "UNSAFE_SVG" });
    expect(checkAsset("LOGO_LIGHT", { name: "a.svg", type: "image/svg+xml", size: 10 }, '<svg><use href="#a"/></svg>')).toEqual({ ok: true });
    expect(checkAsset("LOGO_LIGHT", { name: "a.png", type: "image/png", size: 5 * 1024 * 1024 })).toEqual({ ok: false, reason: "SIZE" });
    expect(checkAsset("LOGO_LIGHT", { name: "a.gif", type: "image/gif", size: 1 })).toEqual({ ok: false, reason: "TYPE" });
    expect(checkAsset("FAVICON", { name: "f.ico", type: "", size: 1 })).toEqual({ ok: true });
    expect(checkAsset("LOGIN_BACKGROUND", { name: "b.jpg", type: "", size: 1 })).toEqual({ ok: true });
    expect(contrastCheck("nope")).toEqual({ ratio: null, label: null, low: false });
    expect(contrastCheck("0055AA").low).toBe(false);
    const form = { ...formOf(null), loginMessage: "x".repeat(101), mailSenderName: "y".repeat(51), mailSignature: "z".repeat(501) };
    expect(validateBranding(form)).toEqual({ loginMessage: "LOGIN_MESSAGE", mailSenderName: "SENDER_NAME", mailSignature: "SIGNATURE" });
    expect(brandingBody({ ...formOf(null), primaryColor: "0055aa", faviconAssetId: "9" }, 4, false)).toMatchObject({ primaryColor: "#0055AA", faviconAssetId: "9", loginMessage: null, appName: null, baseVersion: 4 });
  });
});
