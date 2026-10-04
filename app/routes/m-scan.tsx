/**
 * UI-DSH-14 [QR 스캔](`/m/scan`, AT-DSH-16.2): 기기 QR을 읽어 모바일 기기 상세로. 다른 조직·권한 밖 QR은 "찾을 수 없는 기기"(TC-DSH-124).
 * 현장 설치 권한(DEV_PLACE)이 있으면 [현장 설치] 바로 가기.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useRouteLoaderData } from "react-router";
import { Alert, Card } from "~/components/ui";
import { fieldApi } from "~/features/field/api";
import { QrScanner } from "~/features/field/components/qr-scanner";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";

export default function MobileScan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [error, setError] = useState<string | null>(null);
  const open = async (token: string) => {
    const result = await fieldApi.resolveQr(token);
    if (result.ok) navigate(`/m/devices/${encodeURIComponent(String(result.data.deviceId))}`);
    else setError(result.status === 404 ? t("field.scan.notFound") : t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }));
  };
  return (
    <Card title={t("field.mobile.tab.scan")}>
      {error && <Alert tone="danger">{error}</Alert>}
      <QrScanner onToken={(token) => void open(token)} />
      {hasAny(root?.me?.permissions, ["DEV_PLACE"]) && (
        <Link to="/m/commission" className="mt-3 block text-[13px] text-accent">
          {t("field.board.commission")}
        </Link>
      )}
    </Card>
  );
}
