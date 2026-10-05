/**
 * UI-SIM-02 가상 기기 카탈로그(SIM-09.01, SIM-09.07): 탭(센서·장비·키트), 카드(측정 항목 또는 기능, 기본 특성 요약 3개,
 * 연결된 실제 모델, [배치]), 배치 대화상자(가상 공간 필수, 수량 1~50·남은 한도, 이름 접두어 1~40, 프로필, 보고 모드) → API-SIM-05,
 * 키트 배치(기존 가상 공간 또는 새 가상 공간) → API-SIM-06, 결과의 추천 플로우 [플로우로 만들기] → 템플릿 화면(FLW-01.05).
 */
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, Dialog, EmptyState, SelectField, Table, Tabs, TextField } from "~/components/ui";
import { simErrorText, type SimFailure } from "../model/sim-error";
import { SPACE_PRESETS, checkPlacement, type Problem } from "../model/sim";
import type { KitPlacement, SimCatalog, SimKit, SimProfile, SimType } from "../model/types";
import { VirtualBadge, useProblemText } from "./common";

export type CatalogTab = "sensor" | "actuator" | "kit";

export interface CatalogActionResult {
  intent?: string;
  error?: SimFailure;
  fieldErrors?: Record<string, Problem>;
  placed?: { deviceId: string; name: string }[];
  kit?: KitPlacement;
}

export function metricKeys(type: SimType): string[] {
  return (type.metrics ?? []).map((m) => (typeof m === "string" ? m : m.key));
}

export function CatalogView({
  catalog,
  tab,
  spaces,
  profiles,
  remaining,
  canManage,
  canWriteFlow = false,
  result,
  idempotencyKey,
}: {
  catalog: SimCatalog;
  tab: CatalogTab;
  spaces: { spaceId: string; name: string }[];
  profiles: SimProfile[];
  remaining: number | null;
  canManage: boolean;
  /** 추천 플로우 [플로우로 만들기]는 템플릿(API-FLW-20, FLOW_WRITE)을 쓴다. 없으면 숨긴다 */
  canWriteFlow?: boolean;
  result?: CatalogActionResult;
  idempotencyKey: string;
}) {
  const { t } = useTranslation();
  const [placing, setPlacing] = useState<SimType | null>(null);
  const [kit, setKit] = useState<SimKit | null>(null);
  const types = catalog.types.filter((ty) => (tab === "sensor" ? ty.category === "SENSOR" : ty.category === "ACTUATOR"));

  return (
    <>
      <Tabs
        current={tab}
        items={(["sensor", "actuator", "kit"] as const).map((k) => ({ key: k, label: t(`sim.catalog.tab.${k}`), to: `?tab=${k}` }))}
      />
      {result?.placed && (
        <div className="mb-3">
          <Alert tone="success">{t("sim.catalog.placed", { n: result.placed.length, names: result.placed.map((d) => d.name).join(", ") })}</Alert>
        </div>
      )}
      {result?.kit && <KitResult placement={result.kit} spaces={spaces} canWriteFlow={canWriteFlow} />}
      {result?.error && !placing && !kit && (
        <div className="mb-3">
          <Alert tone="danger">{placementError(t, result.error, remaining)}</Alert>
        </div>
      )}
      {tab === "kit" ? (
        catalog.kits.length === 0 ? (
          <EmptyState title={t("sim.catalog.noKits")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {catalog.kits.map((k) => (
              <Card key={k.key} title={k.name} actions={canManage && <Button onClick={() => setKit(k)}>{t("sim.catalog.place")}</Button>}>
                <ul className="text-[12.5px]">
                  {k.items.map((item) => (
                    <li key={item.typeKey}>{`${catalog.types.find((ty) => ty.key === item.typeKey)?.name ?? item.typeKey} × ${item.count}`}</li>
                  ))}
                </ul>
                {(k.suggestedFlowTemplates ?? []).length > 0 && <p className="mt-2 text-[12px] text-muted">{t("sim.catalog.suggested", { names: (k.suggestedFlowTemplates ?? []).join(", ") })}</p>}
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          {canManage && (
            <div className="mb-3 flex justify-end">
              {/* UI-SIM-14 사용자 정의 유형 만들기(SIM-09.06) */}
              <ButtonLink to={`?tab=${tab}&type=new`}>{t("sim.types.new")}</ButtonLink>
            </div>
          )}
          {types.length === 0 ? (
        <EmptyState title={t("sim.catalog.empty")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-4">
          {types.map((ty) => (
            <Card key={ty.id} title={ty.name} actions={canManage && <Button onClick={() => setPlacing(ty)}>{t("sim.catalog.place")}</Button>}>
              <p className="font-mono text-[12px]">{ty.category === "SENSOR" ? metricKeys(ty).join(" · ") : (ty.capabilities ?? []).join(" · ")}</p>
              <ul className="mt-1 text-[12px] text-muted">
                {(ty.summary ?? ty.propertyDefs.slice(0, 3).map((d) => `${d.name} ${String(d.default)}${d.unit ?? ""}`)).slice(0, 3).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {ty.linkedModelCode && <p className="mt-1 text-[12px]">{t("sim.catalog.model", { code: ty.linkedModelCode })}</p>}
              {!ty.builtin && <Badge tone="neutral">{t("sim.catalog.custom")}</Badge>}
              {!ty.builtin && canManage && (
                <Link className="ml-2 text-[12.5px] text-accent hover:underline" to={`?tab=${tab}&type=${encodeURIComponent(ty.id)}`} aria-label={t("sim.types.editOf", { name: ty.name })}>
                  {t("sim.types.edit")}
                </Link>
              )}
            </Card>
          ))}
        </div>
      )}
        </>
      )}
      {placing && (
        <PlaceDialog
          type={placing}
          spaces={spaces}
          profiles={profiles.filter((p) => p.typeId === placing.id)}
          remaining={remaining}
          result={result?.intent === "place" ? result : undefined}
          idempotencyKey={idempotencyKey}
          onClose={() => setPlacing(null)}
        />
      )}
      {kit && <KitDialog kit={kit} spaces={spaces} result={result?.intent === "kit" ? result : undefined} idempotencyKey={idempotencyKey} onClose={() => setKit(null)} />}
    </>
  );
}

function placementError(t: ReturnType<typeof useTranslation>["t"], error: SimFailure, remaining: number | null) {
  if (error.code === "SIM_DEVICE_QUOTA_EXCEEDED") return t("sim.validation.quota", { limit: 500, remaining: remaining ?? 0 });
  return simErrorText(t, error);
}

function PlaceDialog({
  type,
  spaces,
  profiles,
  remaining,
  result,
  idempotencyKey,
  onClose,
}: {
  type: SimType;
  spaces: { spaceId: string; name: string }[];
  profiles: SimProfile[];
  remaining: number | null;
  result?: CatalogActionResult;
  idempotencyKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [problems, setProblems] = useState<Record<string, Problem>>(result?.fieldErrors ?? {});
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const found = checkPlacement({ spaceId: String(form.get("spaceId") ?? ""), count: Number(form.get("count")), namePrefix: String(form.get("namePrefix") ?? "") }, remaining);
    setProblems(found);
    if (Object.keys(found).length) event.preventDefault();
  };
  return (
    <Dialog title={t("sim.catalog.placeTitle", { name: type.name })} open onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <CsrfField />
        <input type="hidden" name="intent" value="place" />
        <input type="hidden" name="typeId" value={type.id} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <SelectField label={t("sim.catalog.space")} name="spaceId" defaultValue={spaces[0]?.spaceId ?? ""} error={problemText(problems.spaceId)}>
          <option value="">–</option>
          {spaces.map((s) => (
            <option key={s.spaceId} value={s.spaceId}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {spaces.length === 0 && (
          <p className="text-[12px] text-muted">
            {t("sim.catalog.noSpaces")} <Link className="text-accent underline" to="/sim/spaces/new">{t("sim.space.new")}</Link>
          </p>
        )}
        <TextField label={t("sim.catalog.count")} name="count" type="number" min={1} max={50} defaultValue="1" error={problemText(problems.count)} hint={remaining !== null ? t("sim.catalog.remaining", { n: remaining }) : undefined} />
        <TextField label={t("sim.catalog.namePrefix")} name="namePrefix" maxLength={40} defaultValue={type.name} error={problemText(problems.namePrefix)} />
        <SelectField label={t("sim.catalog.profile")} name="profileId" defaultValue="">
          <option value="">{t("sim.catalog.catalogDefault")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("sim.catalog.reportMode")} name="reportMode" defaultValue="ALWAYS">
          <option value="ALWAYS">{t("sim.catalog.ALWAYS")}</option>
          <option value="RUN_ONLY">{t("sim.catalog.RUN_ONLY")}</option>
        </SelectField>
        {result?.error && (
          <p role="alert" className="text-[12.5px] text-bad-ink">
            {placementError(t, result.error, remaining)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary">
            {t("sim.catalog.place")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function KitDialog({ kit, spaces, result, idempotencyKey, onClose }: { kit: SimKit; spaces: { spaceId: string; name: string }[]; result?: CatalogActionResult; idempotencyKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [mode, setMode] = useState<"existing" | "new">(spaces.length ? "existing" : "new");
  return (
    <Dialog title={t("sim.catalog.kitTitle", { name: kit.name })} open onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="kit" />
        <input type="hidden" name="kitKey" value={kit.key} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <SelectField label={t("sim.catalog.kitTarget")} name="mode" value={mode} onChange={(e) => setMode(e.target.value as "existing" | "new")}>
          <option value="existing">{t("sim.catalog.existingSpace")}</option>
          <option value="new">{t("sim.catalog.newSpace")}</option>
        </SelectField>
        {mode === "existing" ? (
          <SelectField label={t("sim.catalog.space")} name="spaceId" defaultValue={spaces[0]?.spaceId ?? ""} error={problemText(result?.fieldErrors?.spaceId)}>
            {spaces.map((s) => (
              <option key={s.spaceId} value={s.spaceId}>
                {s.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <>
            <TextField label={t("sim.catalog.newSpaceName")} name="newSpaceName" maxLength={100} defaultValue={kit.name} error={problemText(result?.fieldErrors?.newSpaceName)} />
            <SelectField label={t("sim.space.preset")} name="preset" defaultValue="CLASSROOM">
              {SPACE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`sim.preset.${p}`)}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <Table>
          <tbody>
            {kit.items.map((item) => (
              <tr key={item.typeKey}>
                <td>{item.typeKey}</td>
                <td className="font-mono">{`× ${item.count}`}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {result?.error && (
          <p role="alert" className="text-[12.5px] text-bad-ink">
            {simErrorText(t, result.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary">
            {t("sim.catalog.place")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

/** 키트 배치 결과: 만든 기기와 추천 플로우(템플릿 화면에 대상 공간을 채워 연다) */
export function KitResult({ placement, spaces, canWriteFlow = false }: { placement: KitPlacement; spaces: { spaceId: string; name: string }[]; canWriteFlow?: boolean }) {
  const { t } = useTranslation();
  const spaceName = spaces.find((s) => s.spaceId === placement.spaceId)?.name ?? placement.spaceId;
  return (
    <Card
      className="mb-3"
      title={
        <span className="inline-flex items-center gap-2">
          {t("sim.catalog.kitPlaced", { space: spaceName, n: placement.devices.length })} <VirtualBadge />
        </span>
      }
    >
      <ul className="flex flex-wrap gap-2 text-[12.5px]">
        {placement.devices.map((d) => (
          <li key={String(d.deviceId)}>
            <Link className="text-accent hover:underline" to={`/devices/${encodeURIComponent(String(d.deviceId))}?tab=virtual`}>
              {d.name}
            </Link>
            {d.relation ? <span className="ml-1 text-muted">{`(${d.relation})`}</span> : null}
          </li>
        ))}
      </ul>
      {canWriteFlow && (placement.suggestedFlows ?? []).length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12.5px] font-semibold">{t("sim.catalog.suggestedFlows")}</p>
          <div className="flex flex-wrap gap-2">
            {(placement.suggestedFlows ?? []).map((f) => (
              <ButtonLink key={f.templateKey} to={`/automation/templates?template=${encodeURIComponent(f.templateKey)}&spaceId=${encodeURIComponent(placement.spaceId)}`} variant="primary">
                {t("sim.catalog.makeFlow", { name: f.name })}
              </ButtonLink>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
