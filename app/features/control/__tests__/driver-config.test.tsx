/**
 * ACT-03.05 UI-ACT-09 드라이버 설정 — TC-ACT-077(AT-ACT-11.3): 인증 정보는 쓰기 전용(입력칸은 password, 저장된 값은 보이지 않고 "저장됨"),
 * 비워 두면 보내지 않음(기존 값 유지), 종류별 연결 정보 칸, 연결 확인(저장 전 /drivers/test, 저장 후 /healthcheck, 실패 원인 표시).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DriverManager } from "../drivers";
import { LG_DRIVER, err, fakeAdminApi, ok } from "./fake-admin";

const ROWS = [
  { driverId: "301", name: "가상 드라이버", type: "VIRTUAL", status: "OK", deviceCount: 6, metrics: { status: "OK", circuit: { state: "CLOSED" }, errorRate: 0, avgMs: 12 } },
  {
    driverId: "303",
    name: "LG ThinQ 본관",
    type: "LG_THINQ",
    status: "CIRCUIT_OPEN",
    deviceCount: 1,
    metrics: { status: "CIRCUIT_OPEN", circuit: { state: "OPEN", openedAt: "2026-10-03T23:58:00Z" }, errorRate: 0.62, avgMs: null },
  },
];

describe("TC-ACT-077 AT-ACT-11.3 드라이버 인증 정보", () => {
  it("LG ThinQ 수정: 저장된 비밀값은 보이지 않고, 비워 두면 secret을 보내지 않으며 baseVersion을 보낸다. 연결 확인 실패는 원인 표시", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ updateDriver: vi.fn(async (_id: string, body: Record<string, unknown>) => ok({ ...LG_DRIVER, ...body, version: 5 })) });
    await renderRoute(<DriverManager initial={ROWS} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click((await screen.findAllByRole("button", { name: "편집" }))[1]);
    const token = await screen.findByLabelText("개인 액세스 토큰");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveValue("");
    expect(token).toHaveAttribute("placeholder", "저장됨 — 바꾸려면 새 값 입력");
    expect(screen.getByLabelText("지역")).toHaveValue("KR");
    expect(screen.getByLabelText("종류")).toBeDisabled();
    expect(document.body.textContent).not.toContain("d2f-secret");

    await user.click(screen.getByRole("button", { name: "연결 확인" }));
    expect(await screen.findByText("드라이버에 연결할 수 없습니다: 드라이버에 연결할 수 없습니다: token expired")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("드라이버를 저장했습니다");
    const [, body] = api.updateDriver.mock.calls[0];
    expect(body).not.toHaveProperty("secret");
    expect(body.baseVersion).toBe(4);
    expect(body.config).toEqual({ region: "KR", clientId: "d2f-client" });
  });

  it("새 LoRaWAN: 필수 칸·주소 형식·비밀값 필수·재시도 0~3 검증, 저장 전 연결 확인(/drivers/test), 저장 본문", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({
      createDriver: vi.fn(async (body: Record<string, unknown>) => ok({ ...LG_DRIVER, ...body, driverId: "400", type: "LORAWAN", status: "UNTESTED", hasSecret: true, version: 1 }, 201)),
    });
    await renderRoute(<DriverManager initial={[]} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(await screen.findByText("드라이버가 없습니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새 드라이버" }));
    await user.clear(screen.getByLabelText("재시도 횟수"));
    await user.type(screen.getByLabelText("재시도 횟수"), "5");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("이름을 1~100자로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("인증 정보를 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("0~3 사이로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("공용 ChirpStack 실제 다운링크는 사용자 승인 전까지 보내지 않습니다")).toBeInTheDocument();
    await user.type(screen.getByLabelText("이름"), "본관 LoRaWAN");
    await user.type(screen.getByLabelText("ChirpStack 주소"), "ftp://x");
    await user.type(screen.getByLabelText("애플리케이션 ID"), "1");
    await user.type(screen.getByLabelText("기본 fPort"), "10");
    await user.type(screen.getByLabelText("API 토큰"), "tok-1");
    await user.clear(screen.getByLabelText("재시도 횟수"));
    await user.type(screen.getByLabelText("재시도 횟수"), "3");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getAllByText("값을 확인하세요").length).toBeGreaterThan(0);
    await user.clear(screen.getByLabelText("ChirpStack 주소"));
    await user.type(screen.getByLabelText("ChirpStack 주소"), "http://cs.test");
    await user.click(screen.getByRole("button", { name: "연결 확인" }));
    expect(await screen.findByText("연결됨 · 84ms · 지원 기능 Switch, Thermostat")).toBeInTheDocument();
    expect(api.testDriver.mock.calls[0][0]).toMatchObject({ type: "LORAWAN", secret: { apiToken: "tok-1" } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.createDriver).toHaveBeenCalled());
    expect(api.createDriver.mock.calls[0][0]).toMatchObject({
      name: "본관 LoRaWAN",
      type: "LORAWAN",
      config: { chirpstackUrl: "http://cs.test", applicationId: "1", fPortDefault: 10, confirmed: true },
      secret: { apiToken: "tok-1" },
      retry: { maxAttempts: 3 },
    });
    expect(await screen.findByText("본관 LoRaWAN")).toBeInTheDocument();
  });

  it("종류를 바꾸면 그 종류의 칸(MQTT 토픽 기본값, SmartThings 토큰), 삭제 실패는 DRIVER_IN_USE", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeAdminApi({ deleteDriver: vi.fn(async () => err(409, "DRIVER_IN_USE")) });
    await renderRoute(<DriverManager initial={ROWS} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click(await screen.findByRole("button", { name: "새 드라이버" }));
    await user.selectOptions(screen.getByLabelText("종류"), "MQTT");
    expect(screen.getByLabelText("명령 토픽")).toHaveValue("devices/{device-key}/command");
    await user.selectOptions(screen.getByLabelText("종류"), "SMARTTHINGS");
    expect(screen.getByLabelText("토큰")).toHaveAttribute("type", "password");
    await user.click(screen.getAllByRole("button", { name: "삭제" })[0]);
    expect(await screen.findByText("모델에 연결된 드라이버라 삭제할 수 없습니다")).toBeInTheDocument();
  });
});
