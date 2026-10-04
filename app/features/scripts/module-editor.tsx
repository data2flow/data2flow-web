/**
 * 공유 모듈(UI-SCR-06, SCR-04.01): 새 모듈 대화상자와 모듈 편집기(코드 DRAFT 저장, 버전 배포, 버전 목록·삭제, 버전별 사용 스크립트).
 * 모듈 이름은 소문자·숫자·`-` 3~40자, 코드 64KB. 스크립트는 `import { … } from 'module:이름@버전'`으로 버전을 지정해 가져온다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CodeEditor, type EditorFactory } from "~/components/code-editor";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Table, TextArea, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { ModuleApi, ModuleDetail, ModuleUsage } from "./m5-api";
import { MODULE_TEMPLATE, checkModuleName, moduleImportLine } from "./model/m5";
import { CODE_LIMIT_BYTES, byteSize } from "./model/script-model";

export function CreateModuleDialog({ open, onClose, onCreated, api }: { open: boolean; onClose: () => void; onCreated: (module: ModuleDetail) => void; api: Pick<ModuleApi, "create"> }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!checkModuleName(name)) return setNameError(t("scripts.modules.validation.name"));
    setNameError(null);
    setBusy(true);
    const result = await api.create({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), code: MODULE_TEMPLATE });
    setBusy(false);
    if (!result.ok) {
      if (result.errors?.some((e) => e.field === "name")) return setNameError(t("scripts.modules.validation.nameTaken"));
      return setError(errorText(t, result) ?? "");
    }
    onCreated(result.data);
  };

  return (
    <Dialog title={t("scripts.modules.new")} open={open} onClose={onClose}>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField label={t("scripts.modules.name")} value={name} placeholder="milesight-channels" onChange={(e) => setName(e.target.value)} error={nameError ?? undefined} hint={t("scripts.modules.nameHint")} />
      <TextField label={t("scripts.modules.description")} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {t("common.create")}
        </Button>
      </div>
    </Dialog>
  );
}

export function ModuleEditor({ module, canWrite, timezone, api, editorFactory }: { module: ModuleDetail; canWrite: boolean; timezone: string; api: ModuleApi; editorFactory?: EditorFactory }) {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState(module);
  const [code, setCode] = useState(module.draftCode ?? "");
  const [savedCode, setSavedCode] = useState(module.draftCode ?? "");
  const [description, setDescription] = useState(module.description ?? "");
  const [usage, setUsage] = useState<ModuleUsage | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const dirty = code !== savedCode || description !== (current.description ?? "");
  const tooLarge = byteSize(code) > CODE_LIMIT_BYTES;

  useEffect(() => {
    void api.usage(module.id).then((r) => {
      if (r.ok) setUsage(r.data);
    });
  }, [api, module.id]);

  const save = async () => {
    setBusy(true);
    const result = await api.save(current.id, { name: current.name, description: description.trim() || undefined, code });
    setBusy(false);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setCurrent(result.data);
    setSavedCode(code);
    setNotice({ tone: "success", text: t("scripts.modules.saved") });
  };

  const release = async () => {
    setConfirmRelease(false);
    setBusy(true);
    if (dirty) {
      const saved = await api.save(current.id, { name: current.name, description: description.trim() || undefined, code });
      if (!saved.ok) {
        setBusy(false);
        return setNotice({ tone: "danger", text: errorText(t, saved) ?? "" });
      }
      setSavedCode(code);
    }
    const result = await api.release(current.id);
    setBusy(false);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setCurrent((m) => ({ ...m, latestVersionNo: result.data.versionNo, versions: [{ versionNo: result.data.versionNo, status: "RELEASED", releasedAt: result.data.releasedAt }, ...(m.versions ?? [])] }));
    setNotice({ tone: "success", text: t("scripts.modules.released", { n: result.data.versionNo }) });
  };

  const removeVersion = async (versionNo: number) => {
    if (!window.confirm(t("scripts.modules.confirmDelete", { n: versionNo }))) return;
    const result = await api.deleteVersion(current.id, versionNo);
    if (!result.ok) {
      return setNotice({ tone: result.code === "SCRIPT_MODULE_IN_USE" ? "warning" : "danger", text: result.code === "SCRIPT_MODULE_IN_USE" ? t("scripts.modules.inUse", { n: versionNo }) : (errorText(t, result) ?? "") });
    }
    setCurrent((m) => ({ ...m, versions: (m.versions ?? []).filter((v) => v.versionNo !== versionNo) }));
  };

  const usersOf = (versionNo: number) => (usage?.scripts ?? []).filter((s) => s.versionNo === versionNo);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="info">{current.latestVersionNo ? t("scripts.modules.latest", { n: current.latestVersionNo }) : t("scripts.modules.unreleased")}</Badge>
          <code className="text-[12px] text-muted">{moduleImportLine(current.name, current.latestVersionNo)}</code>
          {dirty && (
            <span className="text-accent" aria-label={t("scripts.editor.unsaved")}>
              ●
            </span>
          )}
          <span className={tooLarge ? "ml-auto text-[12px] text-bad" : "ml-auto text-[12px] text-muted"}>{tooLarge ? t("scripts.editor.tooLarge") : t("scripts.editor.size", { kb: (byteSize(code) / 1024).toFixed(1) })}</span>
          {canWrite && (
            <>
              <Button disabled={busy || !dirty || tooLarge} onClick={() => void save()}>
                {t("scripts.editor.save")}
              </Button>
              <Button variant="primary" disabled={busy || tooLarge || !code.trim()} onClick={() => setConfirmRelease(true)}>
                {t("scripts.modules.release")}
              </Button>
            </>
          )}
        </div>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <TextArea label={t("scripts.modules.description")} value={description} rows={2} disabled={!canWrite} onChange={(e) => setDescription(e.target.value)} />
        <div className="mt-2">
          <CodeEditor label={t("scripts.editor.code")} value={code} onChange={setCode} problems={[]} readOnly={!canWrite} factory={editorFactory} />
        </div>
        <p className="mt-1 text-[12px] text-muted">{t("scripts.modules.exportHint")}</p>
      </div>
      <Card title={t("scripts.modules.versions")}>
        {(current.versions ?? []).length === 0 ? (
          <EmptyState title={t("scripts.modules.noVersions")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("scripts.ops.version")}</th>
                <th>{t("scripts.modules.releasedAt")}</th>
                <th>{t("scripts.modules.usedBy")}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {(current.versions ?? []).map((v) => {
                const users = usersOf(v.versionNo);
                return (
                  <tr key={v.versionNo}>
                    <td className="font-mono">{`v${v.versionNo}`}</td>
                    <td>{formatDateTime(v.releasedAt, timezone, i18n.language)}</td>
                    <td>
                      {users.length === 0 ? (
                        <span className="text-muted">{t("scripts.modules.unused")}</span>
                      ) : (
                        users.map((u) => (
                          <Link key={u.scriptId} to={`/scripts/${encodeURIComponent(u.scriptId)}`} className="mr-1 text-accent hover:underline">
                            {u.scriptName}
                          </Link>
                        ))
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <Button variant="danger" onClick={() => void removeVersion(v.versionNo)}>
                          {t("common.delete")}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog title={t("scripts.modules.release")} open={confirmRelease} onClose={() => setConfirmRelease(false)}>
        <p className="text-[13px]">{t("scripts.modules.releaseBody", { n: (current.latestVersionNo ?? 0) + 1 })}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmRelease(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void release()}>
            {t("scripts.modules.release")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
