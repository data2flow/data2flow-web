/**
 * 로컬 미리보기 로그인 미리 채우기 안전장치(OPS-08.01, ADR-057).
 * localhost/127.0.0.1 웹 주소 + Secure 쿠키 꺼짐일 때만 켜지고, 그 밖에는 경고만 남기고 꺼진다.
 */
import { describe, expect, it } from "vitest";
import { loadConfig, previewLoginFrom } from "../config.server";

const CREDS = { DATA2FLOW_PREVIEW_LOGIN_ID: "admin01", DATA2FLOW_PREVIEW_LOGIN_PASSWORD: "Preview-x-Aa1" };

function check(env: NodeJS.ProcessEnv, origin: string, secure: boolean) {
  const warnings: string[] = [];
  const result = previewLoginFrom(env, origin, secure, (m) => warnings.push(m));
  return { result, warnings };
}

describe("OPS-08.01 미리보기 로그인 미리 채우기 안전장치", () => {
  it("값이 없으면 꺼짐(기본), 경고도 없다", () => {
    expect(check({}, "http://localhost:3000", false)).toEqual({ result: undefined, warnings: [] });
  });

  it("localhost·127.0.0.1 + Secure 꺼짐이면 켜진다", () => {
    expect(check(CREDS, "http://localhost:3000", false).result).toEqual({ loginId: "admin01", password: "Preview-x-Aa1" });
    expect(check(CREDS, "http://127.0.0.1:3000", false).result).toEqual({ loginId: "admin01", password: "Preview-x-Aa1" });
  });

  it("실제 호스트(운영 주소)면 경고하고 꺼진다", () => {
    const { result, warnings } = check(CREDS, "https://data2flow.java21.net", false);
    expect(result).toBeUndefined();
    expect(warnings[0]).toMatch(/refused/);
  });

  it("localhost를 흉내 낸 호스트(localhost.evil.com)도 꺼진다", () => {
    expect(check(CREDS, "http://localhost.evil.com", false).result).toBeUndefined();
  });

  it("Secure 쿠키가 켜져 있으면 localhost라도 꺼진다", () => {
    expect(check(CREDS, "http://localhost:3000", true).result).toBeUndefined();
  });

  it("아이디·비밀번호 중 하나만 있으면 경고하고 꺼진다", () => {
    const { result, warnings } = check({ DATA2FLOW_PREVIEW_LOGIN_ID: "admin01" }, "http://localhost:3000", false);
    expect(result).toBeUndefined();
    expect(warnings[0]).toMatch(/both/);
  });

  it("잘못된 웹 주소면 꺼진다", () => {
    expect(check(CREDS, "not a url", false).result).toBeUndefined();
  });

  it("loadConfig: 운영 기본값(https 운영 주소, Secure 켜짐)에서는 값을 넣어도 previewLogin이 없다", () => {
    const config = loadConfig({ ...CREDS });
    expect(config.previewLogin).toBeUndefined();
  });

  it("loadConfig: 로컬 미리보기 설정이면 previewLogin이 있다", () => {
    const config = loadConfig({ ...CREDS, DATA2FLOW_PUBLIC_ORIGIN: "http://localhost:3000/", DATA2FLOW_COOKIE_SECURE: "false" });
    expect(config.previewLogin).toEqual({ loginId: "admin01", password: "Preview-x-Aa1" });
  });
});
