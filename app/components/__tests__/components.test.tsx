import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../test/render";
import { AppShell } from "../app-shell";
import { ErrorView } from "../error-view";
import { PasswordFields, passwordProblemText } from "../password-fields";
import { LanguageSwitcher, PublicShell } from "../public-shell";
import { RoleOptions } from "../role-options";
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, CsrfField, PageHeader, SelectField, Table, Tabs, TextArea, TextField } from "../ui";

describe("TC-IAM-008 AT-IAM-01.1 상단 메뉴(IAM-04.05 보조 숨김)", () => {
  it("임시 비밀번호 상태면 메뉴가 하나도 없다", async () => {
    await renderRoute(<AppShell me={meOf("ADMIN", { mustChangePassword: true })}>본문</AppShell>, { session: meOf("ADMIN") });
    await screen.findByText("본문");
    expect(screen.getByRole("navigation", { name: "주 메뉴" }).querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  });

  it("TC-IAM-012 AT-IAM-01.3 비밀번호를 바꾼 ADMIN은 관리 메뉴가 모두 보인다, OPERATOR는 관리 메뉴 없이 업무 메뉴만", async () => {
    const { unmount } = await renderRoute(<AppShell me={meOf("ADMIN")}>본문</AppShell>, { session: meOf("ADMIN") });
    await screen.findByText("본문");
    const links = screen.getByRole("navigation", { name: "주 메뉴" }).querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/", "/spaces", "/devices", "/explore", "/ingest/monitor", "/alarms", "/automation/flows", "/control/commands", "/sim", "/admin/members", "/admin/roles", "/admin/security", "/admin/audit", "/admin/settings", "/admin/maintenance", "/admin/channels"]);
    expect(screen.getByRole("link", { name: "김운영" })).toHaveAttribute("href", "/me");
    unmount();
    await renderRoute(<AppShell me={meOf("OPERATOR")}>본문</AppShell>, { session: meOf("OPERATOR") });
    await screen.findByText("본문");
    expect(screen.getByRole("navigation", { name: "주 메뉴" }).querySelectorAll("a")).toHaveLength(10);
    expect(document.querySelector('input[name="_csrf"]')).toHaveValue("csrf-test-token");
  });
});

describe("UI-IAM-13 오류·접근 안내", () => {
  it("403: 권한 없음 문구, 401: 다시 로그인 버튼과 탭 알림", async () => {
    const { unmount } = await renderRoute(<ErrorView status={403} code="PERMISSION_DENIED" />);
    expect(await screen.findByText("이 페이지를 볼 권한이 없습니다")).toBeInTheDocument();
    unmount();
    const post = vi.fn();
    const original = globalThis.BroadcastChannel;
    vi.stubGlobal("BroadcastChannel", class { postMessage = post; close() {} onmessage = null; });
    await renderRoute(<ErrorView status={401} code="AUTH_SESSION_REVOKED" requestId="7f3a" />);
    expect(await screen.findByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("요청 ID: 7f3a")).toBeInTheDocument();
    vi.stubGlobal("BroadcastChannel", original);
  });

  it("알 수 없는 상태는 500 문구", async () => {
    await renderRoute(<ErrorView status={418} details="자세히" />);
    expect(await screen.findByText("문제가 생겼습니다")).toBeInTheDocument();
    expect(screen.getByText("자세히")).toBeInTheDocument();
  });
});

describe("UI-IAM-02·03 비밀번호 입력", () => {
  it("강도 표시가 입력에 따라 바뀌고, 문제 문구를 보인다", async () => {
    await renderRoute(<PasswordFields name="newPassword" problem="length" />);
    const input = await screen.findByLabelText("새 비밀번호");
    expect(screen.getByText("없음")).toBeInTheDocument();
    await userEvent.type(input, "Abcdefghij1!xyz");
    expect(screen.getByText("강함")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("비밀번호 규칙에 맞지 않습니다: 10~128자여야 합니다");
  });

  it("불일치는 확인 칸에 표시", async () => {
    await renderRoute(<PasswordFields name="newPassword" problem="mismatch" />);
    expect(await screen.findByText("비밀번호가 일치하지 않습니다.")).toBeInTheDocument();
    const t = (k: string) => k;
    expect(passwordProblemText(t, undefined)).toBeUndefined();
    expect(passwordProblemText(t, "required")).toBe("validation.passwordRequired");
  });
});

describe("ADR-037 공개 페이지 틀", () => {
  it("언어 전환은 주소 접두사만 바꾼다(검색어 유지)", async () => {
    await renderRoute(<LanguageSwitcher />, { path: "/login", url: "/login?next=%2Fme" });
    expect(await screen.findByRole("link", { name: "English" })).toHaveAttribute("href", "/en/login?next=%2Fme");
    expect(screen.getByRole("link", { name: "한국어" })).toHaveAttribute("aria-current", "true");
  });

  it("영어 접두사 주소에서는 개인정보 링크도 /en/privacy", async () => {
    await renderRoute(
      <PublicShell title="T" aside={<p>aside</p>}>
        body
      </PublicShell>,
      { path: "/en/login", lang: "en" },
    );
    expect(await screen.findByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/en/privacy");
    expect(screen.getByText("aside")).toBeInTheDocument();
  });
});

describe("공용 부품", () => {
  it("입력·선택·표·탭·배지가 접근 가능한 이름과 상태를 가진다", async () => {
    const onClick = vi.fn();
    await renderRoute(
      <>
        <PageHeader title="제목" crumb="관리" actions={<ButtonLink to="/x">링크</ButtonLink>} />
        <Card title="카드" actions={<Badge>배지</Badge>}>
          <TextField label="이름" name="name" error="오류" />
          <TextField label="힌트" name="h" hint="도움말" />
          <TextArea label="메모" name="memo" error="길어요" />
          <SelectField label="역할" name="role" error="골라요">
            <RoleOptions customRoles={[{ id: "31", name: "야간 당직" }]} />
          </SelectField>
          <Checkbox label="동의" name="c" error="필수" />
          <Button onClick={onClick}>누르기</Button>
          <Alert tone="danger">위험</Alert>
          <Alert>정보</Alert>
          <Badge tone="neutral">중립</Badge>
          <Tabs current="a" items={[{ key: "a", label: "A", to: "?a" }, { key: "b", label: "B", to: "?b" }]} />
          <Table>
            <tbody>
              <tr>
                <td>셀</td>
              </tr>
            </tbody>
          </Table>
          <CsrfField />
        </Card>
      </>,
    );
    expect(await screen.findByLabelText("이름")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("도움말")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "야간 당직" })).toHaveValue("CUSTOM:31");
    expect(screen.getByRole("option", { name: "관리자" })).toHaveValue("ADMIN");
    await userEvent.click(screen.getByRole("button", { name: "누르기" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(3));
  });
});
