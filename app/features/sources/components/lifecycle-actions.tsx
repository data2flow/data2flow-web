/**
 * 소스 상태 버튼(DSC-07.01, TC-DSC-168): 상태에 맞는 버튼만 보이고, [일시정지]·[보관]·[삭제]는 사용처 요약 확인 대화상자(BR-DSC-20).
 * [보관]은 소스 코드를 그대로 입력해야 확인 버튼이 켜진다. [복제]는 새 코드·이름을 받아 DRAFT로 만든다(BR-DSC-11).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button, CsrfField, Dialog, TextField } from "~/components/ui";
import { checkCode, lifecycleActions, type LifecycleAction } from "../model/source";

export interface UsageSummary {
  deviceCount?: number;
  flows?: { id: string; name: string }[];
}

const CONFIRM: LifecycleAction[] = ["pause", "archive", "delete"];

export function LifecycleActions({ code, lifecycle, version, usage }: { code: string; lifecycle: string; version: number; usage?: UsageSummary | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<LifecycleAction | null>(null);
  const [typed, setTyped] = useState("");
  const [cloneCode, setCloneCode] = useState(`${code}-copy`.slice(0, 50));
  const [cloneName, setCloneName] = useState("");
  const actions = lifecycleActions(lifecycle);
  const close = () => {
    setOpen(null);
    setTyped("");
  };
  const confirmDisabled = open === "archive" ? typed !== code : open === "clone" ? !checkCode(cloneCode) || !cloneName.trim() : false;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) =>
        CONFIRM.includes(action) || action === "clone" ? (
          <Button key={action} variant={action === "delete" || action === "archive" ? "danger" : "secondary"} onClick={() => setOpen(action)}>
            {t(`sources.action.${action}`)}
          </Button>
        ) : (
          <Form method="post" key={action}>
            <CsrfField />
            <input type="hidden" name="baseVersion" value={version} />
            <Button type="submit" name="intent" value={action} variant="primary">
              {t(`sources.action.${action}`)}
            </Button>
          </Form>
        ),
      )}
      <Dialog title={open ? t(`sources.confirm.${open}.title`) : ""} open={open !== null} onClose={close}>
        <Form method="post" className="flex flex-col gap-3" onSubmit={close}>
          <CsrfField />
          <input type="hidden" name="intent" value={open ?? ""} />
          <input type="hidden" name="baseVersion" value={version} />
          {open && open !== "clone" && (
            <>
              <p className="text-[13px]">{t(`sources.confirm.${open}.body`)}</p>
              <p className="text-[13px] text-muted">{t("sources.confirm.usage", { devices: usage?.deviceCount ?? 0, flows: usage?.flows?.length ?? 0 })}</p>
              {usage?.flows && usage.flows.length > 0 && (
                <ul className="list-disc pl-5 text-[12.5px]">
                  {usage.flows.map((f) => (
                    <li key={f.id}>{f.name}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {open === "archive" && <TextField label={t("sources.confirm.typeCode", { code })} name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
          {open === "clone" && (
            <>
              <p className="text-[13px]">{t("sources.confirm.clone.body")}</p>
              <TextField label={t("sources.form.code")} name="code" value={cloneCode} onChange={(e) => setCloneCode(e.target.value)} error={checkCode(cloneCode) ? undefined : t("sources.validation.code")} />
              <TextField label={t("sources.form.name")} name="name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("common.cancel")}</Button>
            <Button type="submit" variant={open === "clone" ? "primary" : "danger"} disabled={confirmDisabled}>
              {open ? t(`sources.action.${open}`) : ""}
            </Button>
          </div>
        </Form>
      </Dialog>
    </div>
  );
}
