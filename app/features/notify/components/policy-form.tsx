/**
 * UI-RUL-06 알림 정책 편집 폼(RUL-03.02·03.03·03.06). 서버 action으로 보내는 일반 폼이고, 수신자·에스컬레이션 단계 표만
 * 클라이언트 상태로 편집해 숨은 입력(`recipient`, `steps` JSON)에 담는다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, SelectField, TextField, cx } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { BUILTIN_ROLES } from "~/lib/api-types";
import type { SpaceNode } from "~/lib/spaces";
import { AGGREGATE_OPTIONS, MAX_STEPS, RENOTIFY_OPTIONS, WEB_CHANNEL, encodeRecipient, type PolicyErrors } from "../model/policy";
import { DAYS } from "../model/oncall";
import { RECIPIENT_TYPES, SEVERITIES, type ChannelType, type NotificationPolicy, type NotificationTemplate, type PolicyStep, type Recipient, type RecipientType } from "../model/types";
import { useRecipientLabel } from "./common";

export interface PolicyFormProps {
  policy: NotificationPolicy;
  spaces: SpaceNode[];
  rules: { id: string; name: string }[] | null;
  templates: NotificationTemplate[];
  channelTypes: ChannelType[];
  users: { id: string; name: string }[];
  usersAvailable: boolean;
  errors?: PolicyErrors;
  readOnly?: boolean;
}

function durationLabel(t: (k: string, o?: Record<string, unknown>) => string, minutes: number) {
  return minutes >= 60 ? t("notify.policy.hours", { count: minutes / 60 }) : t("notify.policy.minutes", { count: minutes });
}

/** 수신자 고르기: 종류 → (사용자·역할이면) 대상 → [추가]. 고른 목록은 빼기 버튼과 함께 */
export function RecipientEditor({ value, onChange, users, usersAvailable, inputName, label, error, disabled }: { value: Recipient[]; onChange: (next: Recipient[]) => void; users: { id: string; name: string }[]; usersAvailable: boolean; inputName?: string; label: string; error?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const labelOf = useRecipientLabel(users);
  const [type, setType] = useState<RecipientType>("ROLE");
  const [target, setTarget] = useState("");
  const needsTarget = type === "USER" || type === "ROLE";
  const add = () => {
    if (needsTarget && !target.trim()) return;
    const next: Recipient = needsTarget ? { type, id: target.trim() } : { type };
    if (!value.some((r) => encodeRecipient(r) === encodeRecipient(next))) onChange([...value, next]);
    setTarget("");
  };
  return (
    <fieldset className="flex flex-col gap-2" aria-invalid={Boolean(error)}>
      <legend className="mb-1 text-[12.5px] font-medium text-muted">{label}</legend>
      <ul className="flex flex-wrap gap-1.5">
        {value.map((r) => (
          <li key={encodeRecipient(r)} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[12.5px]">
            {labelOf(r)}
            {inputName && <input type="hidden" name={inputName} value={encodeRecipient(r)} />}
            {!disabled && (
              <button type="button" className="text-muted hover:text-bad-ink" aria-label={t("notify.policy.remove", { name: labelOf(r) })} onClick={() => onChange(value.filter((x) => encodeRecipient(x) !== encodeRecipient(r)))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label={t("notify.policy.recipientType")} value={type} onChange={(e) => (setType(e.target.value as RecipientType), setTarget(""))}>
            {RECIPIENT_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`notify.recipient.${k}`)}
              </option>
            ))}
          </SelectField>
          {type === "ROLE" && (
            <SelectField label={t("notify.policy.recipientId")} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="" />
              {BUILTIN_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`notify.role.${role}`)}
                </option>
              ))}
            </SelectField>
          )}
          {type === "USER" &&
            (usersAvailable ? (
              <SelectField label={t("notify.policy.recipientId")} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="" />
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <TextField label={t("notify.policy.recipientId")} placeholder={t("notify.policy.userIdPlaceholder")} value={target} onChange={(e) => setTarget(e.target.value)} />
            ))}
          <Button onClick={add} disabled={needsTarget && !target.trim()}>
            {t("notify.policy.addRecipient")}
          </Button>
        </div>
      )}
      {error && <p className="text-[12.5px] text-bad-ink">{error}</p>}
    </fieldset>
  );
}

/** 에스컬레이션 단계 표(최대 3단계, BR-RUL-16). 값은 숨은 입력 `steps`(JSON)로 보낸다 */
export function StepsEditor({ initial, users, usersAvailable, error, disabled }: { initial: PolicyStep[]; users: { id: string; name: string }[]; usersAvailable: boolean; error?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<PolicyStep[]>(initial);
  const update = (index: number, patch: Partial<PolicyStep>) => setSteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const serialized = JSON.stringify(steps.map((s) => ({ waitMinutes: s.waitMinutes, recipients: s.recipients.map(encodeRecipient) })));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("notify.policy.steps")}</legend>
      <p className="text-[12.5px] text-muted">{t("notify.policy.stepsHint")}</p>
      <input type="hidden" name="steps" value={serialized} />
      {steps.map((step, index) => (
        <div key={index} className="rounded-md border border-line p-3" data-testid={`step-${index + 1}`}>
          <div className="mb-2 flex items-end gap-3">
            <strong className="text-[13px]">{t("notify.policy.stepNo", { n: index + 1 })}</strong>
            <TextField label={t("notify.policy.waitMinutes")} type="number" min={1} max={1440} value={String(step.waitMinutes)} disabled={disabled} onChange={(e) => update(index, { waitMinutes: Number(e.target.value) })} />
            {!disabled && (
              <Button variant="ghost" onClick={() => setSteps(steps.filter((_, i) => i !== index))}>
                {t("notify.policy.removeStep", { n: index + 1 })}
              </Button>
            )}
          </div>
          <RecipientEditor label={t("notify.policy.recipients")} value={step.recipients} onChange={(recipients) => update(index, { recipients })} users={users} usersAvailable={usersAvailable} disabled={disabled} />
        </div>
      ))}
      {!disabled && steps.length < MAX_STEPS && (
        <div>
          <Button onClick={() => setSteps([...steps, { stepNo: steps.length + 1, waitMinutes: 10, recipients: [] }])}>{t("notify.policy.addStep")}</Button>
        </div>
      )}
      {error && <p className="text-[12.5px] text-bad-ink">{error}</p>}
    </fieldset>
  );
}

export function PolicyForm({ policy, spaces, rules, templates, channelTypes, users, usersAvailable, errors = {}, readOnly }: PolicyFormProps) {
  const { t } = useTranslation();
  const err = (key: keyof PolicyErrors) => (errors[key] ? t(`notify.policy.errors.${errors[key]}`) : undefined);
  const [recipients, setRecipients] = useState<Recipient[]>(policy.recipients);
  const [timeMode, setTimeMode] = useState(policy.timeWindow ? "WINDOW" : "ALWAYS");
  const [channels, setChannels] = useState<string[]>(policy.channels);
  const [spaceId, setSpaceId] = useState(policy.spaceId ?? "");
  const channelKeys = [WEB_CHANNEL, ...channelTypes.filter((c) => c.available).map((c) => c.key)];
  for (const existing of policy.channels) if (!channelKeys.includes(existing)) channelKeys.push(existing);
  const toggleChannel = (key: string, on: boolean) => setChannels(on ? [...channels, key] : channels.filter((c) => c !== key));
  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-4">
      <TextField label={t("notify.policy.name")} name="name" defaultValue={policy.name} maxLength={100} required error={err("name")} />
      <section className="grid gap-3 md:grid-cols-3">
        <SelectField label={t("notify.policy.minSeverity")} name="minSeverity" defaultValue={policy.minSeverity} error={err("minSeverity")}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t("notify.severityAtLeast", { severity: t(`notify.severity.${s}`) })}
            </option>
          ))}
        </SelectField>
        <SpaceSelect spaces={spaces} label={t("notify.policy.space")} name="spaceId" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} emptyLabel={t("notify.policy.allSpaces")} />
        <div className="self-end">
          <Checkbox label={t("notify.policy.includeChildren")} name="includeChildren" defaultChecked={policy.includeChildren} disabled={!spaceId} />
        </div>
      </section>
      {rules ? (
        <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
          {t("notify.policy.rules")}
          <select name="ruleIds" multiple defaultValue={policy.ruleIds} className="min-h-20 rounded-md border border-line bg-panel px-2 py-1 text-[13px] text-text">
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <p className="text-[12.5px] text-muted">{t("notify.policy.rulesUnavailable")}</p>
          {policy.ruleIds.map((id) => (
            <input key={id} type="hidden" name="ruleIds" value={id} />
          ))}
        </>
      )}
      <fieldset className="flex flex-col gap-2" aria-invalid={Boolean(errors.timeWindow)}>
        <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("notify.policy.time")}</legend>
        <div className="flex gap-4 text-[13px]">
          {(["ALWAYS", "WINDOW"] as const).map((mode) => (
            <label key={mode} className="inline-flex items-center gap-1.5">
              <input type="radio" name="timeMode" value={mode} checked={timeMode === mode} onChange={() => setTimeMode(mode)} />
              {t(mode === "ALWAYS" ? "notify.policy.timeAlways" : "notify.policy.timeWindow")}
            </label>
          ))}
        </div>
        {timeMode === "WINDOW" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2 text-[13px]">
              {DAYS.map((d) => (
                <label key={d} className="inline-flex items-center gap-1">
                  <input type="checkbox" name="days" value={d} defaultChecked={policy.timeWindow ? policy.timeWindow.days.includes(d) : d <= 5} />
                  {t(`notify.days.${d}`)}
                </label>
              ))}
            </div>
            <TextField label={t("notify.policy.from")} name="from" type="time" defaultValue={policy.timeWindow?.from ?? "09:00"} />
            <TextField label={t("notify.policy.to")} name="to" type="time" defaultValue={policy.timeWindow?.to ?? "18:00"} />
          </div>
        )}
        {err("timeWindow") && <p className="text-[12.5px] text-bad-ink">{err("timeWindow")}</p>}
      </fieldset>
      <RecipientEditor label={t("notify.policy.recipients")} value={recipients} onChange={setRecipients} users={users} usersAvailable={usersAvailable} inputName="recipient" error={err("recipients")} disabled={readOnly} />
      <fieldset className="flex flex-col gap-2" aria-invalid={Boolean(errors.channels)}>
        <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("notify.policy.channels")}</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          {channelKeys.map((key) => (
            <label key={key} className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="channel" value={key} checked={channels.includes(key)} onChange={(e) => toggleChannel(key, e.target.checked)} />
              {t(`notify.channel.${key}`, { defaultValue: channelTypes.find((c) => c.key === key)?.displayName ?? key })}
            </label>
          ))}
        </div>
        {err("channels") && (
          <p className={cx("text-[12.5px] text-bad-ink")} role="alert">
            {err("channels")}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {channels
            .filter((c) => c !== WEB_CHANNEL)
            .map((channel) => (
              <SelectField key={channel} label={t("notify.policy.template", { channel: t(`notify.channel.${channel}`, { defaultValue: channel }) })} name={`template_${channel}`} defaultValue={policy.templates[channel] ?? ""}>
                <option value="">{t("notify.policy.defaultTemplate")}</option>
                {templates
                  .filter((tpl) => tpl.channel === channel)
                  .map((tpl) => (
                    <option key={tpl.notificationTemplateId} value={tpl.notificationTemplateId}>
                      {`${tpl.templateKey} (${tpl.locale})`}
                    </option>
                  ))}
              </SelectField>
            ))}
        </div>
      </fieldset>
      <section className="grid gap-3 md:grid-cols-3">
        <SelectField label={t("notify.policy.renotify")} name="renotifyMinutes" defaultValue={String(policy.renotifyMinutes)} error={err("renotifyMinutes")}>
          {[...new Set([...RENOTIFY_OPTIONS, policy.renotifyMinutes])]
            .sort((a, b) => a - b)
            .map((m) => (
              <option key={m} value={m}>
                {durationLabel(t, m)}
              </option>
            ))}
        </SelectField>
        <SelectField label={t("notify.policy.aggregate")} name="aggregateWindowSec" defaultValue={String(policy.aggregateWindowSec)} error={err("aggregateWindowSec")}>
          {[...new Set([...AGGREGATE_OPTIONS, policy.aggregateWindowSec])]
            .sort((a, b) => a - b)
            .map((s) => (
              <option key={s} value={s}>
                {s === 0 ? t("notify.policy.aggregateOff") : t("notify.policy.minutes", { count: s / 60 })}
              </option>
            ))}
        </SelectField>
        <div className="self-end">
          <Checkbox label={t("notify.policy.notifyOnClear")} name="notifyOnClear" defaultChecked={policy.notifyOnClear} />
        </div>
      </section>
      <StepsEditor initial={policy.steps} users={users} usersAvailable={usersAvailable} error={err("steps")} disabled={readOnly} />
    </fieldset>
  );
}
