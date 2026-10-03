import { describe, expect, it } from "vitest";
import { parseSessionKeys, loadConfig } from "../config.server";
import { readCookie, seal, serializeSessionCookie, unseal } from "../session-cookie.server";

const k1 = { kid: "k1", key: Buffer.alloc(32, 1) };
const k2 = { kid: "k2", key: Buffer.alloc(32, 2) };
const payload = { csrf: "c".repeat(43), sid: "sid-1", rt: "refresh-token", iat: 1, la: 2 };

describe("session-cookie IAM-07.04 암호화 세션 쿠키(AES-256-GCM, kid)", () => {
  it("암호화한 값을 같은 키로 열면 원래 내용, 값에는 평문이 없다", () => {
    const value = seal(payload, k1);
    expect(value).toMatch(/^v1\.k1\./);
    expect(value).not.toContain("refresh-token");
    expect(unseal(value, [k1])).toEqual(payload);
  });

  it("kid 교체: 이전 키로 만든 쿠키도 키 목록에 있으면 열린다, 없으면 null", () => {
    const old = seal(payload, k1);
    expect(unseal(old, [k2, k1])).toEqual(payload);
    expect(unseal(old, [k2])).toBeNull();
  });

  it("변조·형식 오류·짧은 CSRF는 null", () => {
    const value = seal(payload, k1);
    const parts = value.split(".");
    const tampered = [...parts.slice(0, 3), `${parts[3].slice(0, -2)}AA`].join(".");
    expect(unseal(tampered, [k1])).toBeNull();
    expect(unseal("garbage", [k1])).toBeNull();
    expect(unseal("v2.k1.a.b", [k1])).toBeNull();
    expect(unseal(`v1.k1.${Buffer.alloc(5).toString("base64url")}.${parts[3]}`, [k1])).toBeNull();
    expect(unseal(seal({ csrf: "short" }, k1), [k1])).toBeNull();
  });

  it("쿠키 속성: HttpOnly·SameSite=Lax·Path=/·Secure, 삭제는 Max-Age=0", () => {
    expect(serializeSessionCookie("v", { secure: true, maxAge: 21600 })).toBe("data2flow_session=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600; Secure");
    const removed = serializeSessionCookie("", { secure: false, maxAge: 0 });
    expect(removed).toContain("Max-Age=0");
    expect(removed).toContain("Expires=Thu, 01 Jan 1970");
    expect(removed).not.toContain("Secure");
  });

  it("Cookie 헤더에서 값 하나를 읽는다", () => {
    expect(readCookie("a=1; data2flow_session=xyz; b", "data2flow_session")).toBe("xyz");
    expect(readCookie(null, "x")).toBeUndefined();
    expect(readCookie("a=1", "x")).toBeUndefined();
  });
});

describe("config 환경 변수", () => {
  it("기본값: gateway http://data2flow-api-gateway, 유휴 30분, 최대 12시간, Secure", () => {
    const config = loadConfig({});
    expect(config.gatewayUrl).toBe("http://data2flow-api-gateway");
    expect(config.publicOrigin).toBe("https://data2flow.java21.net");
    expect(config.sessionIdleMinutes).toBe(30);
    expect(config.sessionAbsoluteHours).toBe(12);
    expect(config.refreshTtlHours).toBe(6);
    expect(config.cookieSecure).toBe(true);
    expect(config.signupRequestEnabled).toBe(false);
    expect(config.contentSecurityPolicy).toBe(false);
    expect(config.sessionKeys[0].key).toHaveLength(32);
  });

  it("운영에서 세션 키가 없으면 기동하지 않는다(auth.md §11 #8)", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATA2FLOW_SESSION_KEYS/);
  });

  it("값 검증: 범위 밖 정수·잘못된 키는 오류", () => {
    expect(() => loadConfig({ DATA2FLOW_SESSION_IDLE_MINUTES: "1" })).toThrow();
    expect(() => parseSessionKeys("nokid")).toThrow();
    expect(() => parseSessionKeys("k1:AAAA")).toThrow(/32 bytes/);
    expect(() => parseSessionKeys("bad kid!:AAAA")).toThrow();
    expect(() => parseSessionKeys(" , ")).toThrow(/empty/);
    const keys = parseSessionKeys(`new:${Buffer.alloc(32, 3).toString("base64")},old:${Buffer.alloc(32, 4).toString("base64")}`);
    expect(keys.map((k) => k.kid)).toEqual(["new", "old"]);
    const config = loadConfig({ DATA2FLOW_ALLOWED_ORIGINS: "http://localhost:5173/, ", DATA2FLOW_GATEWAY_URL: "http://gw/", DATA2FLOW_COOKIE_SECURE: "false", DATA2FLOW_REDIS_URL: "redis://r" });
    expect(config.allowedOrigins).toEqual(["https://data2flow.java21.net", "http://localhost:5173"]);
    expect(config.gatewayUrl).toBe("http://gw");
    expect(config.cookieSecure).toBe(false);
    expect(config.redisUrl).toBe("redis://r");
  });
});
