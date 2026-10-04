/**
 * 연결 테스트 실행(API-DSC-57, DSC-09.11): 쿼리 `timeoutSec`(5~30)을 붙여 BFF로 보내고, 제한 시간 + 여유 3초 안에 응답이 없으면
 * "시간 초과"로 끝낸다(TC-DSC-302). 늦게 온 응답은 버린다.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bffJson } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { clampTestTimeout, type TestResult } from "../model/source";

export const TIMEOUT_GRACE_MS = 3000;

export function useConnectionTest(testPath: string) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const run = useRef(0);

  async function start(body: Record<string, unknown>, timeoutSec: number) {
    const id = ++run.current;
    setTesting(true);
    setError(null);
    setResult(null);
    setTimedOut(false);
    const seconds = clampTestTimeout(timeoutSec);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), seconds * 1000 + TIMEOUT_GRACE_MS);
    });
    const response = await Promise.race([bffJson<TestResult>(`${testPath}?timeoutSec=${seconds}`, { method: "POST", body }), timeout]);
    clearTimeout(timer);
    if (id !== run.current) return;
    setTesting(false);
    if (response === "timeout") {
      setTimedOut(true);
      return;
    }
    if (response.ok) setResult({ ok: response.data?.ok, stage: response.data?.stage, steps: response.data?.steps ?? [], preview: response.data?.preview ?? [], lossPossible: response.data?.lossPossible });
    else setError(errorText(t, response) ?? null);
  }

  return { testing, result, error, timedOut, start };
}
