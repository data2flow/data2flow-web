/**
 * UI-FLW-21 확장 노드 패키지(FLW-11.05, API-FLW-70~73, BR-FLW-33): 설치 입력 검증, 버전 정리.
 * 업그레이드는 기존 버전과 나란히 설치되고 플로우는 명시적으로 새 버전을 적용해야 바뀐다.
 */
export const PACKAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface PackageVersion {
  version: string;
  runtime: "JS_SANDBOX" | "SERVER_PLUGIN";
  license: string;
  signer: string;
  status: "INSTALLED" | "DISABLED";
  installedAt?: string;
}

export interface NodePackage {
  packageId: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  versions: PackageVersion[];
  usedFlowCount: number;
  updatedAt?: string;
}

/** 의미 버전 비교(1.10.0 > 1.9.0, 1.0.0 > 1.0.0-beta). 꼬리(-beta)끼리는 문자열 비교 */
export function compareVersions(a: string, b: string): number {
  const [mainA, preA] = splitVersion(a);
  const [mainB, preB] = splitVersion(b);
  for (let i = 0; i < Math.max(mainA.length, mainB.length); i += 1) {
    const diff = (mainA[i] ?? 0) - (mainB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

function splitVersion(v: string): [number[], string] {
  const index = v.indexOf("-");
  const main = index < 0 ? v : v.slice(0, index);
  return [main.split(".").map((part) => Number(part) || 0), index < 0 ? "" : v.slice(index + 1)];
}

/** 버전을 새것부터 */
export function sortedVersions(pkg: NodePackage): PackageVersion[] {
  return [...pkg.versions].sort((a, b) => compareVersions(b.version, a.version));
}

export function latestVersion(pkg: NodePackage): PackageVersion | undefined {
  return sortedVersions(pkg)[0];
}

export type InstallInputError = "required" | "both" | "extension" | "tooLarge" | "url";

/** 설치 입력: 파일(.d2fpkg, ≤10MB) 또는 등록소 URL(https) 중 하나 */
export function validateInstallInput(file: { name: string; size: number } | null, registryUrl: string): InstallInputError | undefined {
  const hasFile = Boolean(file && file.size > 0);
  const url = registryUrl.trim();
  if (!hasFile && !url) return "required";
  if (hasFile && url) return "both";
  if (hasFile) {
    if (!file!.name.toLowerCase().endsWith(".d2fpkg")) return "extension";
    if (file!.size > PACKAGE_MAX_BYTES) return "tooLarge";
    return undefined;
  }
  return /^https:\/\/[^\s]+$/.test(url) ? undefined : "url";
}

/** 패키지 이름(경로 변수): `acme.modbus-write`처럼 소문자·숫자·점·하이픈 */
export function isValidPackageName(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,99}$/.test(name);
}
