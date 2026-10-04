/**
 * 건물 [3D] 탭(DSH-12.04, UC-DSH-13, API-DSH-24): IFC 모델 목록·열람(매핑 요소는 공간 상태 색, 매핑 없는 요소는 회색, 열람 전용),
 * INTEGRATOR(DEV_ADMIN)는 IFC 올리기(.ifc ≤200MB)·공간 연결 편집·삭제.
 * 3D 렌더링(web-ifc + three.js)은 v1에서 넣지 않고, 공간 요소를 상태 색 타일로 보인다(열람 전용). 원본은 [IFC 내려받기]로 연다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, TextField, cx } from "~/components/ui";
import type { FormResult } from "~/features/spaces/components/space-manage";
import { browserImageUrl } from "~/features/spaces/model/space-forms";
import type { SpaceNode } from "~/lib/spaces";
import { checkIfcFile, formatBytes, mappingCounts, viewerElements, type ElementState, type IfcFileProblem, type ModelDetail, type ModelSummary } from "../model/bim";

const STATE_CLASS: Record<ElementState, string> = {
  ALARM: "border-bad bg-bad-soft text-bad",
  WARNING: "border-warn bg-warn-soft text-warn",
  NORMAL: "border-good bg-good-soft text-good",
  UNMAPPED: "border-line bg-bg text-muted",
};
const STATE_ICON: Record<ElementState, string> = { ALARM: "▲", WARNING: "!", NORMAL: "✔", UNMAPPED: "–" };

export function BimPanel({ spaceId, models, detail, tree, canEdit, result }: { spaceId: string; models: ModelSummary[]; detail: ModelDetail | null; tree: SpaceNode[]; canEdit: boolean; result?: FormResult }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {models.length === 0 ? (
        <EmptyState title={t("bim.empty")} body={canEdit ? undefined : t("bim.askIntegrator")} />
      ) : (
        <Card title={t("bim.models")}>
          <ul className="flex flex-wrap gap-2">
            {models.map((m) => (
              <li key={m.id}>
                <Link to={`/spaces/${spaceId}?tab=model3d&model=${m.id}`} aria-current={detail?.id === m.id ? "true" : undefined} className={cx("inline-flex items-center gap-2 rounded border px-2 py-1 text-[12.5px]", detail?.id === m.id ? "border-accent bg-accent-soft" : "border-line")}>
                  {m.name}
                  <Badge tone={m.status === "READY" ? "success" : m.status === "FAILED" ? "danger" : "neutral"}>{t(`bim.status.${m.status}`, { defaultValue: m.status })}</Badge>
                  <span className="text-muted">{formatBytes(m.sizeBytes)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {detail && <BimViewer detail={detail} tree={tree} canEdit={canEdit} editing={editing} onEdit={setEditing} result={result} />}
      {canEdit && <IfcUpload result={result} />}
    </div>
  );
}

function BimViewer({ detail, tree, canEdit, editing, onEdit, result }: { detail: ModelDetail; tree: SpaceNode[]; canEdit: boolean; editing: boolean; onEdit: (v: boolean) => void; result?: FormResult }) {
  const { t } = useTranslation();
  const elements = viewerElements(detail, tree);
  const counts = mappingCounts(elements);
  const [rows, setRows] = useState(() => elements.map((e) => ({ ifcGlobalId: e.ifcGlobalId, spaceId: e.spaceId ?? "" })));
  return (
    <Card
      title={t("bim.viewer", { name: detail.name })}
      actions={
        <div className="flex gap-2">
          {detail.downloadUrl && (
            <a href={browserImageUrl(detail.downloadUrl) ?? undefined} className="text-[12.5px] text-accent underline" download>
              {t("bim.download")}
            </a>
          )}
          {canEdit && detail.status === "READY" && (
            <Button aria-pressed={editing} onClick={() => onEdit(!editing)}>
              {editing ? t("bim.viewMode") : t("bim.editMapping")}
            </Button>
          )}
        </div>
      }
    >
      {detail.status === "FAILED" && <Alert tone="danger">{t("bim.failed", { error: detail.error ?? "" })}</Alert>}
      {detail.status === "PROCESSING" && <Alert tone="info">{t("bim.processing")}</Alert>}
      <p className="mb-2 text-[12.5px] text-muted">
        {t("bim.counts", { mapped: counts.mapped, unmapped: counts.unmapped })} · {detail.ifcSchema ?? "IFC"} · {t("bim.readOnly")}
      </p>
      {!editing ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" aria-label={t("bim.elements")}>
          {elements.map((e) => (
            <li key={e.ifcGlobalId} data-element={e.ifcGlobalId} data-state={e.state} className={cx("rounded border px-2 py-2 text-[12.5px]", STATE_CLASS[e.state])}>
              <span aria-hidden>{STATE_ICON[e.state]} </span>
              <strong>{e.name}</strong>
              <span className="block text-[11.5px]">
                {e.spaceId ? (
                  <Link to={`/spaces/${e.spaceId}`} className="underline">
                    {e.spaceName ?? e.spaceId}
                  </Link>
                ) : (
                  t("bim.unmapped")
                )}
                {" · "}
                {t(`bim.state.${e.state}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Form method="post" className="flex flex-col gap-2">
          <CsrfField />
          <input type="hidden" name="intent" value="bimMapping" />
          <input type="hidden" name="modelId" value={detail.id} />
          <input type="hidden" name="mappings" value={JSON.stringify(rows)} />
          {rows.map((r, i) => (
            <div key={r.ifcGlobalId} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr]">
              <span className="text-[12.5px]">
                {elements[i].name} <span className="font-mono text-muted">{r.ifcGlobalId}</span>
              </span>
              <SpaceSelect
                spaces={tree}
                label={t("bim.mapTo", { name: elements[i].name })}
                emptyLabel={t("bim.noSpace")}
                value={r.spaceId}
                onChange={(ev) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, spaceId: ev.target.value } : x)))}
              />
            </div>
          ))}
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </Form>
      )}
      {result?.intent === "bimMapping" && result.ok && <p role="status" className="mt-2 text-[12.5px] text-good">{t("common.saved")}</p>}
      {result?.intent === "bimMapping" && result.error && <p role="alert" className="mt-2 text-[12.5px] text-bad">{t(`errors.${result.error.code}`, { defaultValue: t("errors.UNKNOWN") })}</p>}
      {canEdit && (
        <Form method="post" className="mt-3 flex justify-end">
          <CsrfField />
          <input type="hidden" name="intent" value="bimDelete" />
          <input type="hidden" name="modelId" value={detail.id} />
          <Button type="submit" variant="danger">
            {t("bim.delete")}
          </Button>
        </Form>
      )}
    </Card>
  );
}

function IfcUpload({ result }: { result?: FormResult }) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState<IfcFileProblem>(null);
  const serverProblem = result?.intent === "bimUpload" && result.error ? result.error.code : null;
  return (
    <Card title={t("bim.upload")}>
      <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
        <CsrfField />
        <input type="hidden" name="intent" value="bimUpload" />
        <TextField label={t("bim.name")} name="name" maxLength={100} />
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          {t("bim.file")}
          <input
            type="file"
            name="file"
            accept=".ifc"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setProblem(f ? checkIfcFile({ name: f.name, size: f.size }) : null);
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={Boolean(problem)}>
          {t("bim.uploadButton")}
        </Button>
        <p className="w-full text-[12px] text-muted">{t("bim.limit")}</p>
        {(problem || serverProblem) && (
          <p role="alert" className="w-full text-[12px] text-bad">
            {problem ? t(`bim.problem.${problem}`) : t(`errors.${serverProblem}`, { defaultValue: t("errors.UNKNOWN") })}
          </p>
        )}
        {result?.intent === "bimUpload" && result.ok && <p role="status" className="w-full text-[12.5px] text-good">{t("bim.uploaded")}</p>}
      </Form>
    </Card>
  );
}
