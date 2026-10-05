/**
 * UI-IAM-10 API 토큰과 서비스 계정, UI-AIA-07 MCP 토큰(IAM-04.07·05.01~05.04, API-IAM-40~45).
 * - 발급·교체한 원문은 그 대화상자에서 한 번만 보여 주고 닫으면 다시 볼 수 없다(BR-IAM-18). 화면 상태에도 남기지 않는다
 * - 쓰기·제어 범위(write:devices·control:devices·mcp:write)는 ADMIN 승인 대기(PENDING_APPROVAL)로 발급된다(BR-IAM-19)
 * - 교체는 이전 토큰에 0~24시간 유예를 줄 수 있다(BR-IAM-34). 만료 7일 전이면 경고 배지
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScopeField } from "~/components/space-picker";
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, SelectField, Table, TextArea, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDate, formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import type { TokenApi } from "./api";
import { DEFAULT_EXPIRY_DAYS, MAX_GRACE_HOURS, SCOPES, dateAfter, expiringSoon, issueBody, mcpConfig, scopeAllowed, validateIssue, type IssueForm, type ServiceAccount, type TokenItem, type TokenKind } from "./model";

type Failure = { code: string; message?: string } | null;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 원문 1회 표시 + [복사] + MCP 접속 예시 */
export function SecretOnce({ token, kind, pending }: { token: string; kind: TokenKind; pending?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="warning">{t("tokens.once")}</Alert>
      <div className="flex items-center gap-2">
        <code data-testid="token-secret" className="min-w-0 flex-1 break-all rounded border border-line bg-bg p-2 font-mono text-[12px]">
          {token}
        </code>
        <Button onClick={() => void copy(token).then(setCopied)}>{copied ? t("common.copied") : t("common.copy")}</Button>
      </div>
      {pending && <Alert tone="info">{t("tokens.pendingNote")}</Alert>}
      {kind === "MCP" && (
        <div>
          <p className="text-[12px] text-muted">{t("tokens.mcpExample")}</p>
          <pre className="overflow-auto rounded border border-line bg-bg p-2 font-mono text-[11.5px]">{mcpConfig("claude-desktop", token)}</pre>
        </div>
      )}
    </div>
  );
}

export interface IssueDialogProps {
  open: boolean;
  onClose: () => void;
  onIssued: () => void;
  api: TokenApi;
  permissions: readonly string[] | undefined;
  role: string | undefined;
  spaces: SpaceNode[] | null;
  /** 종류를 고정한다(MCP 화면) */
  fixedKind?: TokenKind;
  serviceAccount?: ServiceAccount | null;
  now?: () => number;
}

export function IssueDialog({ open, onClose, onIssued, api, permissions, role, spaces, fixedKind, serviceAccount, now = Date.now }: IssueDialogProps) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = (): IssueForm => ({ kind: fixedKind ?? "MCP", name: "", scopes: [], spaceScope: [], expiresOn: dateAfter(now(), DEFAULT_EXPIRY_DAYS), rateLimitPerMin: "", serviceAccountId: serviceAccount?.id });
  const [form, setForm] = useState<IssueForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [issued, setIssued] = useState<{ token: string; kind: TokenKind; pending: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setIssued(null);
    setForm(initial());
    setErrors({});
    setFailure(null);
    onClose();
  };
  const submit = async () => {
    const spaceScope = formRef.current ? new FormData(formRef.current).getAll("spaceScope").map(String).filter(Boolean) : [];
    const next = { ...form, spaceScope, serviceAccountId: serviceAccount?.id };
    const found = validateIssue(next, now());
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    const res = await api.issue(issueBody(next));
    setBusy(false);
    if (!res.ok) {
      const nameDup = res.errors?.find((e) => e.field === "name");
      if (nameDup) setErrors({ name: "DUPLICATE" });
      else setFailure({ code: res.code, message: res.message });
      return;
    }
    setIssued({ token: res.data.token, kind: next.kind, pending: res.data.status === "PENDING_APPROVAL" });
    onIssued();
  };
  const toggleScope = (code: string, on: boolean) => setForm((f) => ({ ...f, scopes: on ? [...f.scopes, code] : f.scopes.filter((s) => s !== code) }));
  return (
    <Dialog
      title={serviceAccount ? t("tokens.issueFor", { name: serviceAccount.name }) : fixedKind === "MCP" ? t("tokens.issueMcp") : t("tokens.issue")}
      open={open}
      onClose={close}
      footer={
        issued ? (
          <Button onClick={close}>{t("tokens.closeOnce")}</Button>
        ) : (
          <>
            <Button onClick={close}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {t("tokens.issueSubmit")}
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <SecretOnce token={issued.token} kind={issued.kind} pending={issued.pending} />
      ) : (
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
          {!fixedKind && (
            <SelectField label={t("tokens.kind")} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as TokenKind }))}>
              <option value="MCP">{t("tokens.kinds.MCP")}</option>
              <option value="API_KEY">{t("tokens.kinds.API_KEY")}</option>
            </SelectField>
          )}
          <TextField label={t("tokens.name")} value={form.name} maxLength={50} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name ? t(`tokens.errors.${errors.name}`) : undefined} />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[12.5px] font-medium text-muted">{t("tokens.scopes")}</legend>
            {SCOPES.map((scope) => {
              const allowed = serviceAccount ? true : scopeAllowed(scope, permissions, role);
              return (
                <Checkbox
                  key={scope.code}
                  label={
                    <span>
                      <span className="font-mono">{scope.code}</span> <span className="text-muted">{t(`tokens.scope.${scope.code.replace(":", "_")}`)}</span>
                      {scope.approval && (
                        <span className="ml-1">
                          <Badge tone="warning">{t("tokens.needsApproval")}</Badge>
                        </span>
                      )}
                    </span>
                  }
                  checked={form.scopes.includes(scope.code)}
                  disabled={!allowed}
                  onChange={(e) => toggleScope(scope.code, e.target.checked)}
                />
              );
            })}
            {errors.scopes && (
              <p role="alert" className="text-[12px] text-bad">
                {t("tokens.errors.SCOPES")}
              </p>
            )}
          </fieldset>
          {spaces && spaces.length > 0 && <ScopeField spaces={spaces} name="spaceScope" label={t("tokens.spaceScope")} hint={t("tokens.spaceScopeHint")} />}
          <div className="grid grid-cols-2 gap-2">
            <TextField label={t("tokens.expiresOn")} type="date" value={form.expiresOn} onChange={(e) => setForm((f) => ({ ...f, expiresOn: e.target.value }))} error={errors.expiresOn ? t("tokens.errors.EXPIRY") : undefined} />
            <TextField
              label={t("tokens.rate")}
              type="number"
              min={1}
              max={6000}
              placeholder={form.kind === "MCP" ? "60" : "600"}
              value={form.rateLimitPerMin}
              onChange={(e) => setForm((f) => ({ ...f, rateLimitPerMin: e.target.value }))}
              error={errors.rateLimitPerMin ? t("tokens.errors.RATE") : undefined}
            />
          </div>
          {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
        </form>
      )}
    </Dialog>
  );
}

function RotateDialog({ token, api, onClose, onDone }: { token: TokenItem | null; api: TokenApi; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [grace, setGrace] = useState(2);
  const [secret, setSecret] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const close = () => {
    setSecret(null);
    setFailure(null);
    onClose();
  };
  const rotate = async () => {
    if (!token) return;
    const res = await api.rotate(token.id, grace);
    if (res.ok) {
      setSecret(res.data.token);
      onDone();
    } else setFailure({ code: res.code, message: res.message });
  };
  return (
    <Dialog
      title={t("tokens.rotateTitle", { name: token?.name ?? "" })}
      open={token !== null}
      onClose={close}
      footer={
        secret ? (
          <Button onClick={close}>{t("tokens.closeOnce")}</Button>
        ) : (
          <>
            <Button onClick={close}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void rotate()}>
              {t("tokens.rotate")}
            </Button>
          </>
        )
      }
    >
      {secret && token ? (
        <SecretOnce token={secret} kind={token.kind} />
      ) : (
        <>
          <SelectField label={t("tokens.grace")} value={String(grace)} onChange={(e) => setGrace(Number(e.target.value))}>
            {[0, 1, 2, 6, 12, MAX_GRACE_HOURS].map((h) => (
              <option key={h} value={h}>
                {t("tokens.graceHours", { n: h })}
              </option>
            ))}
          </SelectField>
          <p className="text-[12.5px] text-muted">{t("tokens.graceNote")}</p>
          {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
        </>
      )}
    </Dialog>
  );
}

export function statusBadge(item: TokenItem, nowMs: number, t: (k: string, o?: Record<string, unknown>) => string) {
  const tone = item.status === "ACTIVE" ? "success" : item.status === "PENDING_APPROVAL" ? "warning" : item.status === "ROTATING" ? "info" : "neutral";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={tone}>{t(`tokens.status.${item.status}`)}</Badge>
      {expiringSoon(item, nowMs) && <Badge tone="warning">{t("tokens.expiringSoon")}</Badge>}
    </span>
  );
}

export interface TokenTableProps {
  items: TokenItem[];
  showOwner?: boolean;
  /** 승인 대기 탭(ADMIN) */
  approvals?: boolean;
  api: TokenApi;
  timezone: string;
  onChanged: () => void;
  now?: () => number;
}

export function TokenTable({ items, showOwner, approvals, api, timezone, onChanged, now = Date.now }: TokenTableProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [rotating, setRotating] = useState<TokenItem | null>(null);
  const [revoking, setRevoking] = useState<TokenItem | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const act = async (fn: () => Promise<{ ok: boolean; code?: string; message?: string }>) => {
    setFailure(null);
    const res = await fn();
    if (res.ok) onChanged();
    else setFailure({ code: res.code ?? "UNKNOWN", message: res.message });
  };
  if (items.length === 0) return <EmptyState title={approvals ? t("tokens.noPending") : t("tokens.empty")} />;
  return (
    <>
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
      <Table>
        <thead>
          <tr>
            <th>{t("tokens.name")}</th>
            <th>{t("tokens.kind")}</th>
            {showOwner && <th>{t("tokens.owner")}</th>}
            <th>{t("tokens.prefix")}</th>
            <th>{t("tokens.scopes")}</th>
            <th>{t("tokens.expiresOn")}</th>
            <th>{t("tokens.lastUsed")}</th>
            <th>{t("tokens.statusLabel")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{t(`tokens.kinds.${item.kind}`)}</td>
              {showOwner && <td>{item.ownerType === "SERVICE_ACCOUNT" ? t("tokens.serviceAccountOwner", { name: item.ownerName ?? item.ownerId }) : (item.ownerName ?? item.ownerId)}</td>}
              <td className="font-mono text-[12px]">{`${item.tokenPrefix}…`}</td>
              <td className="font-mono text-[11.5px]">{item.scopes.join(", ")}</td>
              <td>{formatDate(item.expiresAt, timezone, lang)}</td>
              <td>{item.lastUsedAt ? `${formatDateTime(item.lastUsedAt, timezone, lang)}${item.lastUsedIp ? ` · ${item.lastUsedIp}` : ""}` : t("tokens.neverUsed")}</td>
              <td>
                {statusBadge(item, now(), t)}
                {item.status === "ROTATING" && item.graceUntil && <span className="block text-[11.5px] text-muted">{t("tokens.graceUntil", { at: formatDateTime(item.graceUntil, timezone, lang) })}</span>}
              </td>
              <td className="whitespace-nowrap">
                {approvals && item.status === "PENDING_APPROVAL" ? (
                  <>
                    <Button variant="primary" onClick={() => void act(() => api.approve(item.id))}>
                      {t("tokens.approve")}
                    </Button>{" "}
                    <Button variant="danger" onClick={() => void act(() => api.reject(item.id))}>
                      {t("tokens.reject")}
                    </Button>
                  </>
                ) : (
                  <>
                    {item.status === "ACTIVE" && <Button onClick={() => setRotating(item)}>{t("tokens.rotate")}</Button>}{" "}
                    {["ACTIVE", "ROTATING", "PENDING_APPROVAL"].includes(item.status) && (
                      <Button variant="danger" onClick={() => setRevoking(item)}>
                        {t("tokens.revoke")}
                      </Button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <RotateDialog token={rotating} api={api} onClose={() => setRotating(null)} onDone={onChanged} />
      <Dialog
        title={t("tokens.revokeTitle")}
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = revoking;
                setRevoking(null);
                if (target) void act(() => api.revoke(target.id));
              }}
            >
              {t("tokens.revoke")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("tokens.revokeBody", { name: revoking?.name ?? "" })}</p>
      </Dialog>
    </>
  );
}

/** 목록 + [새 토큰] (내 토큰·MCP 토큰·조직 전체) */
export function TokenPanel(props: { initial: TokenItem[]; query: { owner?: "me" | "all"; kind?: string; status?: string }; canIssue: boolean; fixedKind?: TokenKind; showOwner?: boolean; approvals?: boolean; api: TokenApi; timezone: string; permissions?: readonly string[]; role?: string; spaces: SpaceNode[] | null; now?: () => number }) {
  const { t } = useTranslation();
  const { initial, query, canIssue, fixedKind, showOwner, approvals, api, timezone, permissions, role, spaces, now } = props;
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const reload = async () => {
    const res = await api.list(query);
    if (res.ok) setItems(res.data.responses);
  };
  return (
    <div className="flex flex-col gap-3">
      {canIssue && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setOpen(true)}>
            {fixedKind === "MCP" ? t("tokens.issueMcp") : t("tokens.issue")}
          </Button>
        </div>
      )}
      <TokenTable items={items} showOwner={showOwner} approvals={approvals} api={api} timezone={timezone} onChanged={() => void reload()} now={now} />
      <IssueDialog open={open} onClose={() => setOpen(false)} onIssued={() => void reload()} api={api} permissions={permissions} role={role} spaces={spaces} fixedKind={fixedKind} now={now} />
    </div>
  );
}

/** 서비스 계정 탭(ADMIN): 만들기·비활성화·키 발급 */
export function ServiceAccountsPanel({ initial, api, spaces, timezone }: { initial: ServiceAccount[]; api: TokenApi; spaces: SpaceNode[] | null; timezone: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [issuing, setIssuing] = useState<ServiceAccount | null>(null);
  const reload = async () => {
    const res = await api.accounts();
    if (res.ok) setItems(res.data.responses);
  };
  const create = async () => {
    if (!name.trim() || name.trim().length > 100) {
      setNameError(true);
      return;
    }
    const res = await api.createAccount({ name: name.trim(), description: description.trim() || undefined });
    if (res.ok) {
      setCreating(false);
      setName("");
      setDescription("");
      setNameError(false);
      await reload();
    } else setFailure({ code: res.code, message: res.message });
  };
  const disable = async (a: ServiceAccount) => {
    const res = await api.disableAccount(a.id);
    if (res.ok) await reload();
    else setFailure({ code: res.code, message: res.message });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t("tokens.accounts.create")}
        </Button>
      </div>
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
      {items.length === 0 ? (
        <EmptyState title={t("tokens.accounts.empty")} body={t("tokens.accounts.emptyBody")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("tokens.name")}</th>
              <th>{t("tokens.accounts.description")}</th>
              <th>{t("tokens.statusLabel")}</th>
              <th>{t("tokens.accounts.keys")}</th>
              <th>{t("tokens.accounts.createdAt")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.description ?? "–"}</td>
                <td>
                  <Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{t(`tokens.accounts.status.${a.status}`)}</Badge>
                </td>
                <td>{a.tokenCount}</td>
                <td>{formatDate(a.createdAt, timezone, i18n.language)}</td>
                <td className="whitespace-nowrap">
                  {a.status === "ACTIVE" && (
                    <>
                      <Button onClick={() => setIssuing(a)}>{t("tokens.accounts.issueKey")}</Button>{" "}
                      <Button variant="danger" onClick={() => void disable(a)}>
                        {t("tokens.accounts.disable")}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        title={t("tokens.accounts.create")}
        open={creating}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void create()}>
              {t("common.create")}
            </Button>
          </>
        }
      >
        <TextField label={t("tokens.name")} value={name} onChange={(e) => setName(e.target.value)} error={nameError ? t("tokens.accounts.nameRule") : undefined} />
        <TextArea label={t("tokens.accounts.description")} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Dialog>
      <IssueDialog open={issuing !== null} onClose={() => setIssuing(null)} onIssued={() => void reload()} api={api} permissions={undefined} role="ADMIN" spaces={spaces} serviceAccount={issuing} fixedKind="API_KEY" />
    </div>
  );
}
