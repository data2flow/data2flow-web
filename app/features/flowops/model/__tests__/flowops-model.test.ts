/**
 * 자동화 부가 화면 모델 단위 테스트: Sink 연결(FLW-04.01), 스냅샷(FLW-11.02), 파이프라인·매핑(FLW-11.03, FLW-09.01), Git 동기화(FLW-11.04), 확장 노드(FLW-11.05).
 */
import { describe, expect, it } from "vitest";
import { normalizeImport, readGitSyncForm, readResolutions, validateCommitMessage, validateGitSync } from "../git-sync";
import { autoMatch, buildMappingRows, chosenFromForm, flattenSpaces, promoteMappings, targetMappings, uniqueReferences, unmappedCount } from "../mapping";
import { compareVersions, isValidPackageName, latestVersion, sortedVersions, validateInstallInput, type NodePackage } from "../packages";
import { approvalBlock, defaultPipeline, failedChecks, hasPipelineErrors, nextStage, readPipelineForm, validatePipeline, type Promotion } from "../pipeline";
import {
  createSinkBody,
  emptySinkForm,
  isValidTarget,
  readSinkForm,
  sinkFormFrom,
  testFailureKind,
  testSinkBody,
  updateSinkBody,
  validateSinkForm,
  withoutSecrets,
} from "../sink";
import { compareTotals, comparePair, normalizeCompare, normalizeRestore, validateSnapshot } from "../snapshot";

const formOf = (entries: [string, string][]) => {
  const form = new FormData();
  for (const [k, v] of entries) form.append(k, v);
  return form;
};

describe("FLW-04.01 Sink 연결 폼(UI-FLW-08, BR-FLW-27)", () => {
  it("읽기·검증: 호스트·포트 필수, 포트 범위, 종류별 필수(DB vs 버킷·org·토큰), 수정 때 비밀값 생략 가능", () => {
    const values = readSinkForm(formOf([["type", "MYSQL"], ["name", " 연구실 "], ["host", "db"], ["port", "3306"], ["database", "lab"], ["username", "u"], ["password", " p "], ["tls", "on"]]));
    expect(values).toMatchObject({ type: "MYSQL", name: "연구실", tls: true, password: " p " });
    expect(validateSinkForm(values, "create")).toEqual({});
    expect(readSinkForm(formOf([["type", "ORACLE"]])).type).toBe("POSTGRESQL");
    const bad = { ...emptySinkForm("POSTGRESQL"), port: "0", host: "a b" };
    expect(validateSinkForm(bad, "create")).toEqual({ name: "required", host: "invalid", port: "range", database: "required", username: "required", password: "required" });
    expect(validateSinkForm({ ...bad, host: "", port: "" }, "test")).toMatchObject({ host: "required", port: "required" });
    expect(validateSinkForm({ ...bad, host: "", port: "" }, "test")).not.toHaveProperty("name");
    const influx = { ...emptySinkForm("INFLUXDB"), name: "i", host: "h" };
    expect(influx.port).toBe("8086");
    expect(validateSinkForm(influx, "create")).toEqual({ bucket: "required", org: "required", token: "required" });
    expect(validateSinkForm({ ...influx, bucket: "b", org: "o" }, "update")).toEqual({});
  });

  it("본문: 생성은 config+secret, 수정은 비밀값을 바꿀 때만, 테스트 본문, 다시 그릴 때 비밀값 제거", () => {
    const pg = { ...emptySinkForm("POSTGRESQL"), name: "pg", host: "h", port: "5432", database: "d", username: "u", password: "p", tls: false };
    expect(createSinkBody(pg)).toEqual({ name: "pg", type: "POSTGRESQL", config: { host: "h", port: 5432, tls: false, database: "d" }, secret: { username: "u", password: "p" } });
    expect(updateSinkBody({ ...pg, username: "", password: "" }, 4)).toEqual({ name: "pg", config: { host: "h", port: 5432, tls: false, database: "d" }, baseVersion: 4 });
    expect(updateSinkBody({ ...pg, username: "", password: "n" }, 4).secret).toEqual({ password: "n" });
    const influx = { ...emptySinkForm("INFLUXDB"), host: "h", bucket: "b", org: "o", token: "t" };
    expect(testSinkBody(influx)).toEqual({ type: "INFLUXDB", config: { host: "h", port: 8086, tls: true, bucket: "b", org: "o" }, secret: { token: "t" } });
    expect(createSinkBody({ ...influx, token: "" }).secret).toEqual({});
    expect(withoutSecrets(pg)).toMatchObject({ password: "", token: "", username: "u" });
    expect(sinkFormFrom({ sinkConnectionId: "1", name: "x", type: "MYSQL", status: "OK" })).toMatchObject({ port: "3306", host: "", tls: true });
    expect(sinkFormFrom({ sinkConnectionId: "1", name: "x", type: "INFLUXDB", status: "OK", config: { host: "h", port: 1, bucket: "b", org: "o", tls: false } })).toMatchObject({ port: "1", bucket: "b", tls: false });
  });

  it("TC-FLW-083 실패 원인: 응답 error.kind, 없으면 메시지에서(TIMEOUT 등), 그래도 없으면 OTHER; 대상 이름 형식", () => {
    expect(testFailureKind({ ok: false, error: { kind: "AUTH" } })).toBe("AUTH");
    expect(testFailureKind(null, "연결할 수 없습니다: TIMEOUT")).toBe("TIMEOUT");
    expect(testFailureKind({ ok: false, error: { kind: "WEIRD" } }, "boom")).toBe("OTHER");
    expect(isValidTarget("room_temp")).toBe(true);
    expect(isValidTarget("public.room")).toBe(true);
    expect(isValidTarget("1room")).toBe(false);
    expect(isValidTarget("drop table")).toBe(false);
  });
});

describe("FLW-11.02 스냅샷(UI-FLW-18)", () => {
  it("입력 검증 표: 이름 1~80자·고유, 메모 500자, 플로우 1~50개(중복 제거)", () => {
    expect(validateSnapshot({ name: " ", memo: "", flowIds: [] })).toEqual({ name: "required", flowIds: "required" });
    expect(validateSnapshot({ name: "x".repeat(81), memo: "m".repeat(501), flowIds: ["a"] })).toEqual({ name: "tooLong", memo: "tooLong" });
    expect(validateSnapshot({ name: "학기", memo: "", flowIds: ["a", "a"] }, ["학기"])).toEqual({ name: "duplicated" });
    expect(validateSnapshot({ name: "새", memo: "", flowIds: Array.from({ length: 51 }, (_, i) => `f${i}`) })).toEqual({ flowIds: "tooMany" });
    expect(validateSnapshot({ name: "새", memo: "", flowIds: ["a", "a"] })).toEqual({});
  });

  it("TC-FLW-233 비교 응답 정리(배열·객체 모양)와 요약 수, 비교할 두 개 고르기", () => {
    const compare = normalizeCompare({ flows: [{ flowId: "f", flowName: "냉방", added: ["n1"], removed: [], changed: [{ nodeId: "n2", field: "config.value", from: 27, to: 28 }, { nodeId: "n2", field: "config.for", from: "PT5M", to: "PT10M" }] }], scripts: [{ scriptId: "s-12", from: 3, to: 4 }], subflows: [{ subflowId: "sf", fromVersion: 1, toVersion: 1 }] });
    expect(compareTotals(compare)).toEqual({ added: 1, removed: 0, changed: 2, scripts: 1 });
    expect(compare.subflows).toEqual([{ id: "sf", from: 1, to: 1 }]);
    const byKey = normalizeCompare({ flows: { "f-2": { added: [], removed: ["n9"], changed: [] } }, scripts: [{ id: "s", from: null, to: 2 }] });
    expect(byKey.flows).toEqual([{ flowId: "f-2", added: [], removed: ["n9"], changed: [] }]);
    expect(byKey.scripts).toEqual([{ id: "s", from: null, to: 2 }]);
    expect(normalizeCompare(null)).toEqual({ flows: [], scripts: [], subflows: [] });
    expect(comparePair(["a", "b"])).toEqual(["a", "b"]);
    expect(comparePair(["a", "a"])).toBeUndefined();
    expect(comparePair(["a", "b", "c"])).toBeUndefined();
  });

  it("TC-FLW-235 복원 응답 정리: 문자열·객체 항목 모두", () => {
    expect(normalizeRestore({ affectedFlows: ["f-1", { flowId: "f-2", flowName: "냉방", fromVersion: 14, toVersion: 12 }], resetNodeStates: ["n1", { flowId: "f-2", nodeId: "n2" }], appliedVersions: { "f-2": 15 } })).toEqual({
      affectedFlows: [
        { flowId: "f-1", flowName: "f-1" },
        { flowId: "f-2", flowName: "냉방", fromVersion: 14, toVersion: 12 },
      ],
      resetNodeStates: [{ nodeId: "n1" }, { flowId: "f-2", nodeId: "n2" }],
      appliedVersions: { "f-2": 15 },
    });
    expect(normalizeRestore(undefined)).toEqual({ affectedFlows: [], resetNodeStates: [], appliedVersions: {} });
    expect(normalizeRestore({ affectedFlows: [{ id: "x", name: "이름" }] }).affectedFlows[0]).toEqual({ flowId: "x", flowName: "이름", fromVersion: null, toVersion: null });
  });
});

describe("FLW-11.03 승격 파이프라인(UI-FLW-19, BR-FLW-31)", () => {
  it("정의 폼 읽기(빈 줄 버림)와 검증(단계 2~5, 키 형식·중복, 검사 값 범위)", () => {
    const form = formOf([
      ["name", "기본"],
      ["stage.0.key", "test"],
      ["stage.0.env", "TEST"],
      ["stage.1.key", "prod"],
      ["stage.1.env", "NOPE"],
      ["stage.1.roles", "ADMIN"],
      ["stage.1.roles", "ROOT"],
      ["stage.1.userIds", "7, 9,"],
      ["stage.1.testRunRequired", "on"],
      ["stage.1.replayDays", "1"],
      ["stage.1.maxCommands", "50"],
      ["stage.2.key", ""],
    ]);
    const values = readPipelineForm(form);
    expect(values.stages).toHaveLength(2);
    expect(values.stages[1]).toEqual({ key: "prod", env: "TEST", approvers: { roles: ["ADMIN"], userIds: ["7", "9"] }, checks: { testRunRequired: true, replayDays: 1, maxCommands: 50, maxNotifications: 0 } });
    expect(hasPipelineErrors(validatePipeline(values))).toBe(false);
    expect(validatePipeline({ name: "", stages: [values.stages[0]] })).toMatchObject({ name: "required", stages: "count" });
    expect(validatePipeline({ name: "x".repeat(81), stages: values.stages }).name).toBe("tooLong");
    const errors = validatePipeline({ name: "a", stages: [values.stages[0], { ...values.stages[0] }, { ...values.stages[1], key: "Prod" }, { ...values.stages[1], key: "", checks: { ...values.stages[1].checks, replayDays: 8 } }] });
    expect(errors.stageErrors?.map((e) => e.key)).toEqual([undefined, "duplicated", "invalid", "required"]);
    expect(errors.stageErrors?.[3].checks).toBe("range");
  });

  it("기본 파이프라인·다음 단계, 승인 가능 판정(본인·검사 실패·대기 아님)", () => {
    const p = defaultPipeline();
    expect(p.stages.map((s) => s.key)).toEqual(["test", "verify", "prod"]);
    expect(nextStage(p, "verify")).toBe("prod");
    expect(nextStage(p, "prod")).toBeUndefined();
    expect(nextStage(p, "x")).toBeUndefined();
    const base: Promotion = { promotionId: "1", snapshotId: "s", fromStage: "verify", toStage: "prod", status: "PENDING", requestedBy: { userId: "7", name: "김" }, checks: [{ name: "testRun", passed: true }] };
    expect(approvalBlock(base, "1")).toBeUndefined();
    expect(approvalBlock(base, "7")).toBe("self");
    expect(approvalBlock({ ...base, status: "CHECK_FAILED" }, "1")).toBe("checkFailed");
    expect(approvalBlock({ ...base, checks: [{ name: "replayCommands", passed: false, detail: "120 / 50" }] }, "1")).toBe("checkFailed");
    expect(approvalBlock({ ...base, status: "APPLIED" }, "1")).toBe("notPending");
    expect(failedChecks({ ...base, checks: [{ name: "a", passed: false }, { name: "b", passed: true }] }).map((c) => c.name)).toEqual(["a"]);
    expect(failedChecks({ ...base, checks: undefined })).toEqual([]);
  });
});

describe("FLW-09.01 승격 대상 매핑(UI-FLW-13, BR-FLW-23)", () => {
  const refs = [
    { kind: "SPACE", id: "v-31", name: "실습실" },
    { kind: "SPACE", id: "v-31", name: "실습실" },
    { kind: "RELATION", id: "controls/Thermostat", name: "controls/Thermostat" },
    { kind: "DEVICE", id: "v-ac", name: "가상 에어컨" },
    { kind: "SCRIPT", id: "s1", name: "보정" },
  ];
  const candidates = { SPACE: [{ id: "31", name: "실습실" }, { id: "32", name: "사무실" }], DEVICE: [{ id: "1042", name: "에어컨" }], SCRIPT: [{ id: "s1", name: "보정" }, { id: "s2", name: "보정" }] };

  it("TC-FLW-200 이름 같으면 자동 제안, 관계는 공간 매핑을 따름, 누락 수 → 매핑하면 0", () => {
    expect(uniqueReferences(refs)).toHaveLength(4);
    expect(autoMatch(refs[0], candidates.SPACE)).toBe("31");
    // 같은 이름 후보가 둘이면 제안하지 않는다
    expect(autoMatch(refs[4], candidates.SCRIPT)).toBe("");
    const rows = buildMappingRows(refs, candidates);
    expect(rows.map((r) => [r.kind, r.targetId, r.mapped])).toEqual([
      ["SPACE", "31", true],
      ["RELATION", "", true],
      ["DEVICE", "", false],
      ["SCRIPT", "", false],
    ]);
    expect(unmappedCount(rows)).toBe(2);
    const mapped = buildMappingRows(refs, candidates, { "DEVICE:v-ac": "1042", "SCRIPT:s1": "s2", "SPACE:v-31": "99" });
    expect(unmappedCount(mapped)).toBe(1); // 후보에 없는 공간 99는 매핑되지 않은 것으로 본다
    expect(promoteMappings(mapped)).toEqual([
      { kind: "DEVICE", sourceId: "v-ac", targetId: "1042" },
      { kind: "SCRIPT", sourceId: "s1", targetId: "s2" },
    ]);
    expect(targetMappings(mapped)).toEqual([
      { from: "v-ac", to: "1042" },
      { from: "s1", to: "s2" },
    ]);
    expect(buildMappingRows([{ kind: "CHANNEL", id: "c", name: "c" }], {})[0].mapped).toBe(false);
  });

  it("폼의 map.* 값과 공간 트리 펼치기(가상 공간 제외)", () => {
    expect(chosenFromForm(new URLSearchParams("map.SPACE:v-31=31&other=1&map.DEVICE:v-ac="))).toEqual({ "SPACE:v-31": "31", "DEVICE:v-ac": "" });
    expect(flattenSpaces([{ id: 1, name: "캠퍼스", children: [{ id: 31, name: "실습실" }, { id: 90, name: "가상 강의실", virtual: true, children: [{ id: 91, name: "가상 하위" }] }] }])).toEqual([
      { id: "1", name: "캠퍼스" },
      { id: "31", name: "실습실" },
      { id: "91", name: "가상 하위" },
    ]);
  });
});

describe("FLW-11.04 Git 동기화(UI-FLW-20, BR-FLW-35)", () => {
  it("입력 검증 표: https://·ssh:// 형식, 브랜치 1~100자, 경로 200자, 자격 증명 참조 필수", () => {
    const settings = readGitSyncForm(formOf([["repoUrl", " ssh://git@github.com/a.git "], ["branch", "main"], ["authType", "BAD"], ["credentialRef", "key"], ["targets", "FLOW"], ["targets", "NOPE"]]));
    expect(settings).toEqual({ repoUrl: "ssh://git@github.com/a.git", branch: "main", path: "/", auth: { type: "SSH_KEY", credentialRef: "key" }, targets: ["FLOW"] });
    expect(validateGitSync(settings)).toEqual({});
    expect(validateGitSync({ ...settings, repoUrl: "git@github.com:a.git", branch: "b".repeat(101), path: "p".repeat(201), auth: { type: "HTTPS_TOKEN", credentialRef: "" } })).toEqual({ repoUrl: "invalid", branch: "tooLong", path: "tooLong", credentialRef: "required" });
    expect(validateGitSync({ ...settings, repoUrl: "", branch: "" })).toMatchObject({ repoUrl: "required", branch: "required" });
    expect(validateCommitMessage(" ")).toBe("required");
    expect(validateCommitMessage("m".repeat(201))).toBe("tooLong");
    expect(validateCommitMessage("ok")).toBeUndefined();
  });

  it("TC-FLW-255 충돌 해결 읽기: 고르지 않은 충돌은 missing, 미리보기 정리", () => {
    const form = formOf([["resolve.flows/a.yaml", "GIT"], ["resolve.flows/b.yaml", "BOTH"]]);
    expect(readResolutions(form, ["flows/a.yaml", "flows/b.yaml"])).toEqual({ resolutions: [{ objectKey: "flows/a.yaml", choose: "GIT" }], missing: ["flows/b.yaml"] });
    expect(normalizeImport(null)).toEqual({ changes: [], conflicts: [], errors: [] });
    expect(normalizeImport({ changes: [{ objectKey: "a", kind: "CREATE", summary: "s" }] }).changes).toHaveLength(1);
  });
});

describe("FLW-11.05 확장 노드 패키지(UI-FLW-21, BR-FLW-33)", () => {
  const pkg: NodePackage = {
    packageId: "p",
    name: "acme.modbus-write",
    status: "ACTIVE",
    usedFlowCount: 2,
    versions: [
      { version: "1.9.0", runtime: "JS_SANDBOX", license: "MIT", signer: "ACME", status: "INSTALLED" },
      { version: "1.10.0", runtime: "JS_SANDBOX", license: "MIT", signer: "ACME", status: "INSTALLED" },
      { version: "1.10.0-beta", runtime: "JS_SANDBOX", license: "MIT", signer: "ACME", status: "INSTALLED" },
    ],
  };

  it("TC-FLW-266 버전 정렬(1.10.0 > 1.9.0)과 최신 버전", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc", "1.0.0-rc")).toBe(0);
    expect(sortedVersions(pkg).map((v) => v.version)).toEqual(["1.10.0", "1.10.0-beta", "1.9.0"]);
    expect(latestVersion({ ...pkg, versions: [] })).toBeUndefined();
  });

  it("설치 입력: 파일(.d2fpkg ≤10MB) 또는 https URL 하나만, 패키지 이름 형식", () => {
    expect(validateInstallInput(null, "")).toBe("required");
    expect(validateInstallInput({ name: "a.d2fpkg", size: 1 }, "https://x")).toBe("both");
    expect(validateInstallInput({ name: "a.zip", size: 1 }, "")).toBe("extension");
    expect(validateInstallInput({ name: "a.D2FPKG", size: 11 * 1024 * 1024 }, "")).toBe("tooLarge");
    expect(validateInstallInput({ name: "a.d2fpkg", size: 10 }, "")).toBeUndefined();
    expect(validateInstallInput({ name: "a.d2fpkg", size: 0 }, "http://x")).toBe("url");
    expect(validateInstallInput(null, "https://registry.example/a")).toBeUndefined();
    expect(isValidPackageName("acme.modbus-write")).toBe(true);
    expect(isValidPackageName("../x")).toBe(false);
  });
});
