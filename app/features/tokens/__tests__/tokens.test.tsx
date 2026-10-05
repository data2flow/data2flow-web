/**
 * UI-IAM-10 API 토큰·서비스 계정, UI-AIA-07 MCP 토큰(IAM-04.07·05.01~05.04, AIA-08) 인수 시험.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ROLE_PERMISSIONS, renderRoute } from "../../../../test/render";
import type { TokenApi } from "../api";
import { IssueDialog, ServiceAccountsPanel, TokenPanel } from "../components";
import { SCOPES, dateAfter, expiringSoon, issueBody, mcpConfig, scopeAllowed, validateIssue, type TokenItem } from "../model";

const NOW = Date.parse("2026-10-04T03:00:00Z");
const now = () => NOW;
const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
const fail = (status: number, code: string, errors?: { field: string; code: string; message: string }[]) => ({ ok: false as const, status, code, message: "", errors });

const TOKEN: TokenItem = {
  id: "41",
  kind: "MCP",
  name: "노트북 Claude",
  tokenPrefix: "data2flow_ab12",
  ownerType: "USER",
  ownerId: "10",
  ownerName: "박분석",
  scopes: ["read:telemetry", "read:analytics"],
  spaceScope: [],
  status: "ACTIVE",
  expiresAt: "2026-10-08T23:59:59Z",
  rateLimitPerMin: 60,
  lastUsedAt: "2026-10-03T02:20:00Z",
  lastUsedIp: "59.28.174.54",
  graceUntil: null,
  createdAt: "2026-07-01T00:00:00Z",
};

function fakeTokenApi(overrides: Partial<TokenApi> = {}): TokenApi {
  return {
    list: vi.fn(async () => ok({ responses: [TOKEN] })),
    issue: vi.fn(async () => ok({ id: "42", token: "data2flow_q3Kf9secret", prefix: "data2flow_q3Kf", status: "ACTIVE" as const }, 201)),
    approve: vi.fn(async () => ok(undefined, 204)),
    reject: vi.fn(async () => ok(undefined, 204)),
    revoke: vi.fn(async () => ok(undefined, 204)),
    rotate: vi.fn(async () => ok({ newTokenId: "43", token: "data2flow_rotatedSecret" })),
    accounts: vi.fn(async () => ok({ responses: [{ id: "3", name: "BI 연동", description: "야간 집계", status: "ACTIVE" as const, tokenCount: 1, createdAt: "2026-09-01T00:00:00Z" }] })),
    createAccount: vi.fn(async (body: { name: string }) => ok({ id: "4", name: body.name, status: "ACTIVE" as const, tokenCount: 0 }, 201)),
    disableAccount: vi.fn(async () => ok({ id: "3", name: "BI 연동", status: "DISABLED" as const, tokenCount: 1 })),
    ...overrides,
  } as TokenApi;
}

const SPACES = [{ id: "31", name: "실습실", type: "ROOM" }];

describe("IAM-05.01 UI-IAM-10 토큰 발급", () => {
  it("TC-AIA-087 AT-AIA-08.1 발급하면 원문을 한 번만 보이고 MCP 접속 예시를 함께, 닫으면 다시 볼 수 없다", async () => {
    const api = fakeTokenApi();
    await renderRoute(<TokenPanel initial={[TOKEN]} query={{ owner: "me", kind: "MCP" }} canIssue fixedKind="MCP" api={api} timezone="Asia/Seoul" permissions={ROLE_PERMISSIONS.ANALYST} role="ANALYST" spaces={SPACES} now={now} />);
    await userEvent.click(await screen.findByRole("button", { name: "+ MCP 토큰 발급" }));
    const dialog = screen.getByRole("dialog", { name: "+ MCP 토큰 발급" });
    expect(within(dialog).queryByLabelText("종류")).toBeNull();
    expect(within(dialog).getByLabelText("만료일")).toHaveValue("2026-01-02".replace("2026-01-02", dateAfter(NOW, 90)));
    await userEvent.type(within(dialog).getByLabelText("이름"), "회의실 Claude");
    await userEvent.click(within(dialog).getByLabelText(/read:analytics/));
    await userEvent.click(within(dialog).getByLabelText("실습실"));
    await userEvent.click(within(dialog).getByRole("button", { name: "발급" }));
    expect(api.issue).toHaveBeenCalledWith({ kind: "MCP", name: "회의실 Claude", scopes: ["read:analytics"], spaceScope: ["31"], expiresAt: `${dateAfter(NOW, 90)}T23:59:59Z` });
    expect(await within(dialog).findByTestId("token-secret")).toHaveTextContent("data2flow_q3Kf9secret");
    expect(within(dialog).getByText(/토큰은 지금만 볼 수 있습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/"Authorization": "Bearer data2flow_q3Kf9secret"/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "확인했습니다(닫기)" }));
    expect(screen.queryByText(/data2flow_q3Kf9secret/)).toBeNull();
    expect(api.list).toHaveBeenCalledWith({ owner: "me", kind: "MCP" });
  });

  it("TC-AIA-077 역할이 허용하지 않는 범위는 비활성(ANALYST: 쓰기·제어), 쓰기 범위는 '승인 필요'와 승인 대기 안내", async () => {
    const api = fakeTokenApi({ issue: vi.fn(async () => ok({ id: "44", token: "data2flow_pend", prefix: "data2flow_pe", status: "PENDING_APPROVAL" as const }, 201)) });
    await renderRoute(<IssueDialog open onClose={vi.fn()} onIssued={vi.fn()} api={api} permissions={ROLE_PERMISSIONS.ANALYST} role="ANALYST" spaces={null} now={now} />);
    expect(await screen.findByLabelText(/control:devices/)).toBeDisabled();
    expect(screen.getByLabelText(/mcp:write/)).toBeDisabled();
    expect(screen.getByLabelText(/read:telemetry/)).toBeEnabled();
    expect(screen.getAllByText("승인 필요")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(screen.getByText("이름은 1~50자로 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("범위를 하나 이상 고르세요")).toBeInTheDocument();
    expect(api.issue).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("이름"), "x");
    await userEvent.click(screen.getByLabelText(/read:telemetry/));
    const expiry = screen.getByLabelText("만료일");
    await userEvent.clear(expiry);
    await userEvent.type(expiry, "2028-01-01");
    await userEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(screen.getByText("만료일은 내일부터 1년 뒤까지입니다")).toBeInTheDocument();
    await userEvent.clear(expiry);
    await userEvent.type(expiry, "2026-12-31");
    await userEvent.type(screen.getByLabelText("분당 호출 한도"), "120");
    await userEvent.selectOptions(screen.getByLabelText("종류"), "API_KEY");
    await userEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(api.issue).toHaveBeenCalledWith(expect.objectContaining({ kind: "API_KEY", rateLimitPerMin: 120, expiresAt: "2026-12-31T23:59:59Z" }));
    expect(await screen.findByText("쓰기·제어 범위가 있어 관리자 승인 뒤에 쓸 수 있습니다.")).toBeInTheDocument();
  });

  it("INTEGRATOR는 쓰기·제어 범위를 고를 수 있다, 이름 중복·한도 초과 오류", async () => {
    const issue = vi.fn().mockResolvedValueOnce(fail(400, "INVALID_REQUEST", [{ field: "name", code: "Duplicated", message: "" }])).mockResolvedValueOnce(fail(409, "API_TOKEN_LIMIT_EXCEEDED"));
    await renderRoute(<IssueDialog open onClose={vi.fn()} onIssued={vi.fn()} api={fakeTokenApi({ issue })} permissions={ROLE_PERMISSIONS.INTEGRATOR} role="INTEGRATOR" spaces={null} now={now} />);
    expect(await screen.findByLabelText(/control:devices/)).toBeEnabled();
    await userEvent.type(screen.getByLabelText("이름"), "중복");
    await userEvent.click(screen.getByLabelText(/control:devices/));
    await userEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText("같은 이름의 토큰이 이미 있습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText("조직의 토큰 한도(50개)를 넘었습니다.")).toBeInTheDocument();
  });
});

describe("IAM-05.03 키 목록·교체·폐기", () => {
  it("TC-IAM-164 목록: 접두어·범위·만료(7일 전 경고)·마지막 사용 시각과 IP", async () => {
    await renderRoute(<TokenPanel initial={[TOKEN, { ...TOKEN, id: "40", name: "예전", status: "REVOKED", lastUsedAt: null }]} query={{ owner: "me" }} canIssue api={fakeTokenApi()} timezone="Asia/Seoul" spaces={null} now={now} />);
    const row = (await screen.findByRole("cell", { name: "노트북 Claude" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("data2flow_ab12…")).toBeInTheDocument();
    expect(within(row).getByText("read:telemetry, read:analytics")).toBeInTheDocument();
    expect(within(row).getByText("곧 만료")).toBeInTheDocument();
    expect(within(row).getByText("2026-10-03 11:20 · 59.28.174.54")).toBeInTheDocument();
    const revoked = screen.getByRole("cell", { name: "예전" }).closest("tr") as HTMLElement;
    expect(within(revoked).getByText("폐기됨")).toBeInTheDocument();
    expect(within(revoked).getByText("사용 기록 없음")).toBeInTheDocument();
    expect(within(revoked).queryByRole("button", { name: "교체" })).toBeNull();
  });

  it("TC-IAM-157 BR-IAM-34 [교체]: 유예 시간을 골라 API-IAM-44, 새 원문은 한 번만", async () => {
    const api = fakeTokenApi();
    await renderRoute(<TokenPanel initial={[TOKEN]} query={{ owner: "me" }} canIssue api={api} timezone="Asia/Seoul" spaces={null} now={now} />);
    await userEvent.click(await screen.findByRole("button", { name: "교체" }));
    const dialog = screen.getByRole("dialog", { name: "노트북 Claude 교체" });
    expect(within(dialog).getByLabelText("이전 토큰 유예")).toHaveValue("2");
    await userEvent.selectOptions(within(dialog).getByLabelText("이전 토큰 유예"), "24");
    await userEvent.click(within(dialog).getByRole("button", { name: "교체" }));
    expect(api.rotate).toHaveBeenCalledWith("41", 24);
    expect(await within(dialog).findByTestId("token-secret")).toHaveTextContent("data2flow_rotatedSecret");
    await userEvent.click(within(dialog).getByRole("button", { name: "확인했습니다(닫기)" }));
    expect(screen.queryByText("data2flow_rotatedSecret")).toBeNull();
  });

  it("교체 실패(409)는 문구, [폐기]는 확인 뒤 API-IAM-43", async () => {
    const api = fakeTokenApi({ rotate: vi.fn(async () => fail(409, "API_TOKEN_STATE_CONFLICT")) as never });
    await renderRoute(<TokenPanel initial={[{ ...TOKEN, status: "ROTATING", graceUntil: "2026-10-04T05:00:00Z" }, { ...TOKEN, id: "50", name: "새 키" }]} query={{ owner: "me" }} canIssue api={api} timezone="Asia/Seoul" spaces={null} now={now} />);
    expect(await screen.findByText("2026-10-04 14:00까지 이전 토큰 사용 가능")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "교체" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "교체" }));
    expect(await screen.findByText("지금 상태에서는 할 수 없는 작업입니다.")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
    await userEvent.click(screen.getAllByRole("button", { name: "폐기" })[0]);
    const confirm = screen.getByRole("dialog", { name: "토큰 폐기" });
    expect(within(confirm).getByText(/1분 안에/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: "폐기" }));
    expect(api.revoke).toHaveBeenCalledWith("41");
    await waitFor(() => expect(api.list).toHaveBeenCalled());
  });

  it("TC-IAM-158 승인 대기 탭(ADMIN): [승인]·[거절], 비면 안내", async () => {
    const pending = { ...TOKEN, id: "60", status: "PENDING_APPROVAL" as const, scopes: ["control:devices"] };
    const api = fakeTokenApi({ list: vi.fn(async () => ok({ responses: [] })) });
    await renderRoute(<TokenPanel initial={[pending, { ...pending, id: "61", name: "둘째" }]} query={{ owner: "all", status: "PENDING_APPROVAL" }} canIssue={false} approvals showOwner api={api} timezone="Asia/Seoul" spaces={null} now={now} />);
    expect(screen.queryByRole("button", { name: "+ 새 토큰" })).toBeNull();
    expect(await screen.findAllByRole("cell", { name: "박분석" })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole("button", { name: "승인" })[0]);
    expect(api.approve).toHaveBeenCalledWith("60");
    expect(await screen.findByText("승인 대기 중인 토큰이 없습니다")).toBeInTheDocument();
  });

  it("거절이 실패하면 문구", async () => {
    const pending = { ...TOKEN, id: "60", status: "PENDING_APPROVAL" as const };
    await renderRoute(<TokenPanel initial={[pending]} query={{ owner: "all" }} canIssue={false} approvals api={fakeTokenApi({ reject: vi.fn(async () => fail(404, "API_TOKEN_NOT_FOUND")) as never })} timezone="Asia/Seoul" spaces={null} now={now} />);
    await userEvent.click(await screen.findByRole("button", { name: "거절" }));
    expect(await screen.findByText("토큰을 찾을 수 없습니다.")).toBeInTheDocument();
  });
});

describe("IAM-05.01 서비스 계정", () => {
  it("TC-IAM-160 만들기·비활성화, 계정 키 발급은 serviceAccountId와 API 키로", async () => {
    const api = fakeTokenApi();
    await renderRoute(<ServiceAccountsPanel initial={[{ id: "3", name: "BI 연동", description: "야간 집계", status: "ACTIVE", tokenCount: 1, createdAt: "2026-09-01T00:00:00Z" }]} api={api} spaces={null} timezone="Asia/Seoul" />);
    await userEvent.click(await screen.findByRole("button", { name: "+ 서비스 계정" }));
    const create = screen.getByRole("dialog", { name: "+ 서비스 계정" });
    await userEvent.click(within(create).getByRole("button", { name: "만들기" }));
    expect(within(create).getByText("이름은 1~100자로 입력해 주세요")).toBeInTheDocument();
    await userEvent.type(within(create).getByLabelText("이름"), "에너지 대시보드");
    await userEvent.click(within(create).getByRole("button", { name: "만들기" }));
    expect(api.createAccount).toHaveBeenCalledWith({ name: "에너지 대시보드", description: undefined });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "키 발급" }));
    const issue = screen.getByRole("dialog", { name: "BI 연동 키 발급" });
    await userEvent.type(within(issue).getByLabelText("이름"), "BI 키");
    await userEvent.click(within(issue).getByLabelText(/control:devices/));
    await userEvent.click(within(issue).getByRole("button", { name: "발급" }));
    expect(api.issue).toHaveBeenCalledWith(expect.objectContaining({ kind: "API_KEY", serviceAccountId: "3", scopes: ["control:devices"] }));
    await userEvent.click(await within(issue).findByRole("button", { name: "확인했습니다(닫기)" }));
    await userEvent.click(screen.getByRole("button", { name: "비활성화" }));
    expect(api.disableAccount).toHaveBeenCalledWith("3");
  });

  it("TC-IAM-162 만들기 실패 문구, 빈 목록 안내", async () => {
    const api = fakeTokenApi({ createAccount: vi.fn(async () => fail(404, "SERVICE_ACCOUNT_NOT_FOUND")) as never });
    await renderRoute(<ServiceAccountsPanel initial={[]} api={api} spaces={null} timezone="Asia/Seoul" />);
    expect(await screen.findByText("서비스 계정이 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ 서비스 계정" }));
    await userEvent.type(screen.getByLabelText("이름"), "x");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("서비스 계정을 찾을 수 없습니다.")).toBeInTheDocument();
  });
});

describe("IAM-04.07 토큰 모델", () => {
  it("범위 허용·검증·본문·만료 임박·MCP 예시", () => {
    const read = SCOPES[0];
    const write = SCOPES.find((s) => s.code === "write:devices")!;
    expect(scopeAllowed(read, ROLE_PERMISSIONS.VIEWER, "VIEWER")).toBe(true);
    expect(scopeAllowed(SCOPES[1], ROLE_PERMISSIONS.VIEWER, "VIEWER")).toBe(false);
    expect(scopeAllowed(write, ROLE_PERMISSIONS.OPERATOR, "OPERATOR")).toBe(false);
    expect(scopeAllowed(write, ROLE_PERMISSIONS.INTEGRATOR, "INTEGRATOR")).toBe(true);
    expect(validateIssue({ kind: "MCP", name: "a", scopes: ["read:telemetry"], spaceScope: [], expiresOn: dateAfter(NOW, 1), rateLimitPerMin: "0" }, NOW)).toEqual({ rateLimitPerMin: "RATE" });
    expect(validateIssue({ kind: "MCP", name: "a", scopes: ["x"], spaceScope: [], expiresOn: dateAfter(NOW, 0), rateLimitPerMin: "" }, NOW)).toEqual({ expiresOn: "EXPIRY" });
    expect(issueBody({ kind: "API_KEY", name: " a ", scopes: ["s"], spaceScope: [], expiresOn: "2026-12-01", rateLimitPerMin: "" })).toEqual({ kind: "API_KEY", name: "a", scopes: ["s"], spaceScope: [], expiresAt: "2026-12-01T23:59:59Z" });
    expect(expiringSoon({ status: "ACTIVE", expiresAt: "2026-10-30T00:00:00Z" }, NOW)).toBe(false);
    expect(expiringSoon({ status: "REVOKED", expiresAt: "2026-10-05T00:00:00Z" }, NOW)).toBe(false);
    expect(JSON.parse(mcpConfig("json", "T"))).toEqual({ url: "https://data2flow-mcp.java21.net/mcp", transport: "streamable-http", headers: { Authorization: "Bearer T" } });
  });
});
