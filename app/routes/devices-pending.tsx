/**
 * UI-DEV-05 승인 대기 기기(DEV-02.03, ADR-031). 수신 데이터로 발견된 PENDING 기기에 모델·공간을 지정해 승인(API-DEV-15)하거나
 * 거부(API-DEV-28, 무시 목록)한다. 미리 보기: 최근값, 원본 3건(API-ING-05), 추천 모델(API-DEV-29), 원본 위치 태그로 추천 공간.
 * 조회 VIEWER+, 승인·거부 OPERATOR+(DEV_PLACE). 승인 전 데이터는 유지된다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, CsrfField, Dialog, EmptyState, PageHeader, Pager, SelectField, Table, TextField, cx } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { LatestValueCards } from "~/features/devices/components";
import { MAX_APPROVE, checkApproval, checkTags, parseTags, suggestSpace, summarizeResults, type ApproveResult, type DeviceSummary, type LatestValue } from "~/features/devices/model/devices";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/devices-pending";

export function meta() {
  return [{ title: "data2flow" }];
}

interface Suggestion {
  modelId: string;
  modelCode?: string;
  modelName?: string;
  matchedMetrics?: string[];
  score: number;
}

interface RawRow {
  id: string;
  receivedAt?: string;
  topic?: string;
  status?: string;
  sizeBytes?: number;
  payload?: string;
}

const PAGE_SIZE = 50;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const previewId = url.searchParams.get("preview");
  const [devices, spaces, models] = await Promise.all([
    callList<DeviceSummary & { latest?: LatestValue[] }>(ctx, request, `/api/v1/core/devices?status=PENDING&sort=createdAt,desc&page=${page}&size=${PAGE_SIZE}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string; code: string; name: string; status?: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
  ]);
  const list = listOrThrow(devices);
  let preview: { device: DeviceSummary; latest: LatestValue[]; suggestions: Suggestion[]; raw: RawRow[]; rawFailed: boolean } | null = null;
  const target = list.responses.find((d) => d.id === previewId);
  if (target) {
    const now = ctx.runtime.now();
    const from = new Date(now - 7 * 86_400_000).toISOString();
    const to = new Date(now).toISOString();
    const [detail, suggestions, raw] = await Promise.all([
      callApi<{ latest?: LatestValue[] }>(ctx, request, `/api/v1/core/devices/${encodeURIComponent(target.id)}`),
      callApi<Suggestion[]>(ctx, request, `/api/v1/core/devices/${encodeURIComponent(target.id)}/model-suggestions`),
      callList<RawRow>(ctx, request, `/api/v1/core/ingest/raw-messages?${new URLSearchParams({ deviceId: target.id, from, to, size: "3" })}`),
    ]);
    preview = {
      device: target,
      latest: detail.ok ? (detail.data?.latest ?? []) : [],
      suggestions: suggestions.ok ? (Array.isArray(suggestions.data) ? suggestions.data : []).slice(0, 3) : [],
      raw: raw.ok ? raw.list.responses.slice(0, 3) : [],
      rawFailed: !raw.ok,
    };
  }
  return {
    devices: list,
    page,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    models: (models.ok ? models.list.responses : []).filter((m) => m.status !== "DEPRECATED"),
    preview,
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = {
  intent: string;
  results?: ApproveResult[];
  fieldErrors?: Record<string, string>;
  error?: { code: string; message?: string };
  rejected?: number;
};

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const deviceIds = form.getAll("deviceId").filter((v): v is string => typeof v === "string");
  if (intent === "approve") {
    const modelId = field(form, "modelId");
    const spaceId = field(form, "spaceId");
    const errors = checkApproval({ count: deviceIds.length, modelId, spaceId });
    const tags = parseTags(field(form, "tags"));
    const tagProblem = checkTags(tags);
    if (tagProblem) errors.tags = tagProblem;
    if (Object.keys(errors).length) return data({ intent, fieldErrors: errors } as ActionResult, { status: 400 });
    const name = field(form, "name").trim();
    const result = await callApi<{ results: ApproveResult[] }>(ctx, request, "/api/v1/core/devices/approve", {
      method: "POST",
      idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
      body: {
        items: deviceIds.map((id) => ({ deviceId: id, baseVersion: Number(field(form, `version:${id}`)) || 0 })),
        modelId,
        spaceId,
        name: deviceIds.length === 1 && name ? name : undefined,
        tags: tags.length ? tags : undefined,
        applyModelPackage: form.get("applyModelPackage") === "on",
      },
    });
    if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
    return { intent, results: result.data?.results ?? [] } as ActionResult;
  }
  if (intent === "reject") {
    if (deviceIds.length === 0) return data({ intent, fieldErrors: { selection: "selectRequired" } } as ActionResult, { status: 400 });
    const result = await callApi<{ results: ApproveResult[] }>(ctx, request, "/api/v1/core/devices/reject", {
      method: "POST",
      body: { deviceIds, addToIgnoreList: form.get("addToIgnoreList") === "on" },
    });
    if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
    return { intent, results: result.data?.results ?? [] } as ActionResult;
  }
  return data({ intent, error: { code: "INVALID_REQUEST" } } as ActionResult, { status: 400 });
}

export default function DevicesPending({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canPlace = hasAny(root?.me?.permissions, ["DEV_PLACE"]);
  const timezone = root?.timezone ?? "Asia/Seoul";
  const [params] = useSearchParams();
  const { devices, spaces, models, preview, page, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const summary = result?.results ? summarizeResults(result.results) : undefined;
  const failedById = summary?.failedById ?? {};
  const rows = devices.responses;
  const [selected, setSelected] = useState<string[]>(() => {
    const failed = Object.keys(failedById).filter((id) => rows.some((d) => d.id === id));
    if (failed.length) return failed;
    return preview ? [preview.device.id] : [];
  });
  const [rejectOpen, setRejectOpen] = useState(false);
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const single = selected.length === 1 ? rows.find((d) => d.id === selected[0]) : undefined;
  const suggestedModel = preview && single && preview.device.id === single.id ? preview.suggestions[0]?.modelId : undefined;
  const suggestedSpace = single ? suggestSpace(spaces, single.sourceMeta) : undefined;
  const fieldErrors = result?.fieldErrors ?? {};
  const fmt = (iso?: string | null) => formatDateTime(iso ?? undefined, timezone, i18n.language);
  const previewLink = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("preview", id);
    return `?${next}`;
  };

  return (
    <>
      <PageHeader title={t("devices.pending.title", { n: devices.totalCount ?? rows.length })} actions={<ButtonLink to="/devices/pending">{t("common.refresh")}</ButtonLink>} />
      <DeviceAreaTabs current="pending" pendingCount={devices.totalCount ?? rows.length} />
      {summary && result?.intent === "approve" && (
        <div className="mb-3">
          <Alert tone={summary.failed ? "warning" : "success"}>{t("devices.resultSummary", { ok: summary.succeeded, failed: summary.failed })}</Alert>
        </div>
      )}
      {summary && result?.intent === "reject" && (
        <div className="mb-3">
          <Alert tone="success">{t("devices.pending.rejected", { n: summary.succeeded })}</Alert>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {fieldErrors.selection && (
        <div className="mb-3">
          <Alert tone="danger">{t(`devices.errors.${fieldErrors.selection}`, { n: MAX_APPROVE })}</Alert>
        </div>
      )}
      <p className="mb-3 text-[12.5px] text-muted">{t("devices.pending.liveGap")}</p>
      {rows.length === 0 ? (
        <EmptyState title={t("devices.pending.empty")} body={t("devices.pending.emptyBody")} action={<ButtonLink to="/sources">{t("devices.goSources")}</ButtonLink>} />
      ) : (
        <Form method="post" id="pending-form">
          <CsrfField />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {selected.map((id) => (
            <input key={id} type="hidden" name="deviceId" value={id} />
          ))}
          {rows.map((d) => (
            <input key={d.id} type="hidden" name={`version:${d.id}`} value={d.version ?? 0} />
          ))}
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">{t("devices.select")}</span>
                  </th>
                  <th>{t("devices.name")}</th>
                  <th>{t("devices.externalId")}</th>
                  <th>{t("devices.source")}</th>
                  <th>{t("devices.firstSeen")}</th>
                  <th>{t("devices.lastSeen")}</th>
                  <th>{t("devices.pending.metrics")}</th>
                  <th>{t("devices.pending.rawTags")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className={cx(failedById[d.id] && "bg-bad-soft")}>
                    <td>
                      <input type="checkbox" aria-label={t("devices.selectOne", { name: d.name })} checked={selected.includes(d.id)} onChange={() => toggle(d.id)} disabled={!canPlace} />
                    </td>
                    <td>
                      <Link to={previewLink(d.id)} className="font-medium text-accent hover:underline">
                        {d.sourceMeta?.deviceName ?? d.name}
                      </Link>
                      {failedById[d.id] && (
                        <span role="alert" className="block text-[12px] text-bad">
                          {errorText(t, { code: failedById[d.id] })}
                        </span>
                      )}
                    </td>
                    <td className="font-mono">{d.externalId}</td>
                    <td>{d.source?.name ?? "–"}</td>
                    <td>{fmt(d.firstSeenAt)}</td>
                    <td>{fmt(d.lastSeenAt)}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {(d.metrics ?? []).map((m) => (
                          <Badge key={m} tone="neutral">
                            {m}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="font-mono text-[12px]">
                      {Object.entries(d.sourceMeta?.tags ?? {})
                        .map(([k, v]) => `${k}=${v}`)
                        .join(" · ") || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} totalPages={devices.totalPages} />
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title={t("devices.pending.preview")}>
              {preview && single?.id === preview.device.id ? (
                <div className="flex flex-col gap-3">
                  <p className="font-mono text-[12px]">
                    {Object.entries(preview.device.sourceMeta?.tags ?? {})
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </p>
                  {preview.latest.length > 0 ? <LatestValueCards latest={preview.latest} lang={i18n.language} /> : <p className="text-muted">{t("devices.noData")}</p>}
                  <div>
                    <p className="text-[12.5px] font-medium text-muted">{t("devices.pending.suggestions")}</p>
                    {preview.suggestions.length === 0 ? (
                      <p className="text-muted">{t("devices.pending.noSuggestion")}</p>
                    ) : (
                      <ul>
                        {preview.suggestions.map((s) => (
                          <li key={s.modelId}>
                            {`${s.modelName ?? s.modelCode} — ${t("devices.pending.score", { n: Math.round(s.score * (s.score <= 1 ? 100 : 1)) })}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-[13px]">{t("devices.pending.rawRecent", { n: preview.raw.length })}</summary>
                    {preview.rawFailed && <p className="text-[12px] text-muted">{t("devices.pending.rawUnavailable")}</p>}
                    <ul className="mt-2 flex flex-col gap-1">
                      {preview.raw.map((r) => (
                        <li key={r.id} className="font-mono text-[12px]">
                          {fmt(r.receivedAt)} · {r.topic} · {r.status}
                          {r.payload && <pre className="mt-1 max-h-32 overflow-auto rounded bg-bg p-2">{r.payload}</pre>}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ) : (
                <p className="text-muted">{t("devices.pending.previewHint")}</p>
              )}
            </Card>

            {canPlace && (
              <Card title={t("devices.pending.approve")}>
                <div className="flex flex-col gap-3" key={`${single?.id ?? "many"}-${suggestedModel ?? ""}`}>
                  <p className="text-[12.5px] text-muted">{t("common.selectedCount", { n: selected.length })}</p>
                  <SelectField label={t("devices.model")} name="modelId" defaultValue={suggestedModel ?? ""} error={fieldErrors.modelId && t(`devices.errors.${fieldErrors.modelId}`)}>
                    <option value="">{t("devices.chooseModel")}</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {`${m.name || m.code}${m.id === suggestedModel ? ` ${t("devices.pending.suggested")}` : ""}`}
                      </option>
                    ))}
                  </SelectField>
                  <SpaceSelect spaces={spaces} label={t("devices.space")} name="spaceId" defaultValue={suggestedSpace ?? ""} error={fieldErrors.spaceId && t(`devices.errors.${fieldErrors.spaceId}`)} />
                  {suggestedSpace && <p className="text-[12px] text-muted">{t("devices.pending.spaceFromTag")}</p>}
                  {selected.length === 1 && <TextField label={t("devices.name")} name="name" defaultValue={single?.name ?? ""} maxLength={100} />}
                  <TextField label={t("devices.tags")} name="tags" hint={t("devices.tagHint")} error={fieldErrors.tags && t(`devices.errors.${fieldErrors.tags}`)} />
                  <Checkbox label={t("devices.pending.applyPackage")} name="applyModelPackage" defaultChecked />
                  <div className="flex justify-end gap-2">
                    <Button variant="danger" onClick={() => setRejectOpen(true)} disabled={selected.length === 0}>
                      {t("devices.pending.reject")}
                    </Button>
                    <Button type="submit" name="intent" value="approve" variant="primary" disabled={selected.length === 0}>
                      {t("devices.pending.approveButton")}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </Form>
      )}
      <Dialog
        title={t("devices.pending.rejectTitle")}
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        footer={
          <Button type="submit" form="reject-form" variant="danger">
            {t("devices.pending.reject")}
          </Button>
        }
      >
        <Form method="post" id="reject-form" onSubmit={() => setRejectOpen(false)}>
          <CsrfField />
          <input type="hidden" name="intent" value="reject" />
          {selected.map((id) => (
            <input key={id} type="hidden" name="deviceId" value={id} />
          ))}
          <p className="mb-2 text-[13px]">{t("devices.pending.rejectBody", { n: selected.length })}</p>
          <Checkbox label={t("devices.pending.ignoreAgain")} name="addToIgnoreList" defaultChecked />
        </Form>
      </Dialog>
    </>
  );
}
