/**
 * [서브플로우로 만들기] 대화상자(UI-FLW-11, FLW-01.04): 이름·설명, 입력 포트 수(1~5, 고른 묶음에서 자동), 출력 포트 이름(1~10),
 * 노출 파라미터(고른 노드 설정 중 고르기, 표시 이름). [만들기] → API-FLW-22, 원래 노드들은 서브플로우 노드 하나로 바뀐다(서버).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Dialog, TextArea, TextField } from "~/components/ui";
import { subflowNameProblem, type SubflowDraft, type SubflowParam } from "../model/subflow";

export function SubflowDialog({ draft, busy, error, onCancel, onCreate }: { draft: SubflowDraft; busy?: boolean; error?: string; onCancel: () => void; onCreate: (form: { name: string; description: string; outputNames: string[]; params: SubflowParam[] }) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outputNames, setOutputNames] = useState(draft.outputs.map((o) => o.name));
  const [params, setParams] = useState<SubflowParam[]>([]);
  const [touched, setTouched] = useState(false);
  const nameBad = subflowNameProblem(name);
  return (
    <Dialog
      open
      title={t("flows.subflow.title")}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (!nameBad) onCreate({ name, description, outputNames, params });
            }}
          >
            {busy ? t("common.processing") : t("flows.subflow.create")}
          </Button>
        </>
      }
    >
      <TextField label={t("flows.subflow.name")} value={name} onChange={(e) => setName(e.target.value)} error={touched && nameBad ? t("flows.subflow.nameRule") : undefined} />
      <TextArea label={t("flows.subflow.description")} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <p className="text-[12.5px]">{t("flows.subflow.ports", { inputs: draft.inputs.length, nodes: draft.nodes.length })}</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[12.5px] font-medium text-muted">{t("flows.subflow.outputs")}</legend>
        {draft.outputs.map((o, i) => (
          <TextField key={`${o.from}:${o.port}`} label={t("flows.subflow.output", { n: i + 1, port: o.port })} value={outputNames[i] ?? ""} onChange={(e) => setOutputNames((names) => names.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
      </fieldset>
      {draft.candidates.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[12.5px] font-medium text-muted">{t("flows.subflow.params")}</legend>
          {draft.candidates.map((c) => {
            const chosen = params.find((p) => p.path === c.path);
            return (
              <div key={c.path} className="flex flex-wrap items-end gap-2">
                <Checkbox label={c.label} checked={Boolean(chosen)} onChange={(e) => setParams((list) => (e.target.checked ? [...list, { ...c }] : list.filter((p) => p.path !== c.path)))} />
                {chosen && <TextField label={t("flows.subflow.paramLabel")} value={chosen.label} onChange={(e) => setParams((list) => list.map((p) => (p.path === c.path ? { ...p, label: e.target.value } : p)))} />}
              </div>
            );
          })}
        </fieldset>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
