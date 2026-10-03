import { describe, expect, it } from "vitest";
import { BffSession, safeEqual } from "../session.server";
import { meta, setup } from "./helpers";

const t = setup();

describe("BffSession IAM-03.01·IAM-07.04", () => {
  it("로그인 전 세션: CSRF 토큰만, 확인은 상수 시간 비교", () => {
    t.reset();
    const session = t.session();
    expect(session.authenticated).toBe(false);
    expect(session.checkCsrf("x")).toBe(false);
    const token = session.csrfToken();
    expect(token).toHaveLength(43);
    expect(session.csrfToken()).toBe(token);
    expect(session.checkCsrf(token)).toBe(true);
    expect(session.checkCsrf(null)).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
    expect(session.commit()).toMatch(/Max-Age=7200/);
  });

  it("establish: CSRF를 새로 만들고(세션 고정 방지) 쿠키 수명은 min(Refresh 6h, 남은 절대 수명)", () => {
    const runtime = t.reset();
    const session = t.session();
    const before = session.csrfToken();
    const sid = session.establish({ refreshToken: "rt", mustChangePassword: true });
    expect(sid).toMatch(/^bff-/);
    expect(session.csrfToken()).not.toBe(before);
    expect(session.mustChangePassword).toBe(true);
    expect(session.commit()).toMatch(/Max-Age=21600/);
    session.setMustChangePassword(false);
    session.setMustChangePassword(false);
    expect(session.mustChangePassword).toBe(false);
    session.setIdentity("7", "1");
    session.setIdentity("7", "1");
    expect(session.userId).toBe("7");
    session.updateRefreshToken("rt2");
    expect(session.refreshToken).toBe("rt2");
    session.clearPendingMfa();
    t.state.now += 11 * 3_600_000;
    const late = new BffSession({ csrf: "c".repeat(43), sid: "s", rt: "rt", iat: t.state.now - 11 * 3_600_000, la: t.state.now - 61_000 }, runtime, meta);
    late.touch();
    expect(late.commit()).toMatch(/Max-Age=3600/);
  });

  it("유휴·절대 만료 판정, 이전 키 쿠키는 현재 키로 다시 쓴다, 열 수 없는 쿠키는 지운다", () => {
    t.reset();
    const session = t.session();
    session.establish({ sid: "s1", refreshToken: "rt", mustChangePassword: false });
    const cookie = session.commit()?.split(";")[0].slice("data2flow_session=".length) as string;
    t.state.now += 29 * 60_000;
    expect(t.session(cookie).expired).toBeUndefined();
    t.state.now += 2 * 60_000;
    const idle = t.session(cookie);
    expect(idle.expired).toBe("IDLE");
    expect(idle.expiredRefreshToken).toBe("rt");
    expect(idle.commit()).toMatch(/Max-Age=0/);
    const broken = t.session("v1.k1.xx.yy");
    expect(broken.isDestroyed).toBe(true);
    expect(broken.commit()).toMatch(/Max-Age=0/);
    // kid 교체
    t.reset({ DATA2FLOW_SESSION_KEYS: `k2:${Buffer.alloc(32, 5).toString("base64")},k1:${Buffer.alloc(32, 9).toString("base64")}` });
    const rotated = t.session(cookie);
    expect(rotated.authenticated).toBe(true);
    expect(rotated.commit()).toMatch(/^data2flow_session=v1\.k2\./);
    // touch는 1분에 한 번만 쿠키를 다시 쓴다
    const fresh = new BffSession(null, t.state.runtime, meta);
    fresh.touch();
    expect(fresh.commit()).toBeUndefined();
    fresh.destroy();
    expect(fresh.commit()).toMatch(/Max-Age=0/);
  });
});
