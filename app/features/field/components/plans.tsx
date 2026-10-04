/**
 * 정기 점검 계획 탭(UI-DEV-13 계획 탭, API-DEV-95, DEV-08.05): 목록(이름·대상 그룹·주기·다음 마감·사용)과 편집 폼.
 * 계획 관리는 DEV_ADMIN(INTEGRATOR 이상). 주기 7~1,095일, lead는 주기보다 짧게. 수정은 보낸 키 + baseVersion.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Checkbox, EmptyState, SelectField, Table, TextArea, TextField } from "~/components/ui";
import { fieldApi, type FieldApi } from "../api";
import { PLAN_INTERVAL_MAX, PLAN_INTERVAL_MIN, WORK_ORDER_TYPES, checkPlanInput, planBody, type MaintenancePlan, type PlanInput } from "../model/work-orders";

export interface PlanManagerProps {
  initial: MaintenancePlan[];
  groups: { id: string; name: string }[];
  canManage: boolean;
  api?: FieldApi;
  today: string;
}

const toInput = (p: MaintenancePlan): PlanInput => ({
  name: p.name,
  targetGroupId: p.targetGroupId,
  workType: p.workType,
  intervalDays: String(p.intervalDays),
  leadDays: String(p.leadDays),
  nextDueOn: p.nextDueOn,
  defaultAssigneeId: p.defaultAssigneeId ?? "",
  checklistTemplate: p.checklistTemplate.join("\n"),
  enabled: p.enabled,
});

export function PlanManager({ initial, groups, canManage, api = fieldApi, today }: PlanManagerProps) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState(initial);
  const [editing, setEditing] = useState<MaintenancePlan | "new" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;

  const remove = async (plan: MaintenancePlan) => {
    const result = await api.deletePlan(plan.id);
    if (result.ok) {
      setPlans((list) => list.filter((p) => p.id !== plan.id));
      setMessage({ tone: "success", text: t("field.plans.deleted") });
    } else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
  };

  return (
    <div className="flex flex-col gap-3">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Card title={t("field.plans.title")} actions={canManage && editing === null && <Button variant="primary" onClick={() => setEditing("new")}>{t("field.plans.new")}</Button>}>
        {plans.length === 0 ? (
          <EmptyState title={t("field.plans.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("field.plans.name")}</th>
                <th>{t("field.plans.group")}</th>
                <th>{t("field.plans.interval")}</th>
                <th>{t("field.plans.nextDue")}</th>
                <th>{t("field.plans.enabled")}</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{groupName(p.targetGroupId)}</td>
                  <td>{t("field.plans.everyDays", { days: p.intervalDays, lead: p.leadDays })}</td>
                  <td className="font-mono">{p.nextDueOn}</td>
                  <td>{p.enabled ? t("common.yes") : t("common.no")}</td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      <Button variant="ghost" onClick={() => setEditing(p)}>
                        {t("common.edit")}
                      </Button>
                      <Button variant="ghost" aria-label={t("field.plans.deleteNamed", { name: p.name })} onClick={() => void remove(p)}>
                        {t("common.delete")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing !== null && canManage && (
        <PlanForm
          key={editing === "new" ? "new" : editing.id}
          plan={editing === "new" ? null : editing}
          groups={groups}
          today={today}
          api={api}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setPlans((list) => (list.some((p) => p.id === saved.id) ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved]));
            setEditing(null);
            setMessage({ tone: "success", text: t("common.saved") });
          }}
        />
      )}
    </div>
  );
}

function PlanForm({ plan, groups, today, api, onCancel, onSaved }: { plan: MaintenancePlan | null; groups: { id: string; name: string }[]; today: string; api: FieldApi; onCancel: () => void; onSaved: (plan: MaintenancePlan) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState<PlanInput>(
    plan ? toInput(plan) : { name: "", targetGroupId: groups[0]?.id ?? "", workType: "INSPECTION", intervalDays: "180", leadDays: "7", nextDueOn: today, defaultAssigneeId: "", checklistTemplate: "", enabled: true },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const set = (key: keyof PlanInput) => (e: { target: { value: string } }) => setInput((v) => ({ ...v, [key]: e.target.value }));
  const err = (key: string) => (errors[key] ? t(`field.validation.${key}.${errors[key]}`, { min: PLAN_INTERVAL_MIN, max: PLAN_INTERVAL_MAX }) : undefined);
  const submit = async () => {
    const found = checkPlanInput(input);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = planBody(input);
    const result = plan ? await api.updatePlan(plan.id, { ...body, baseVersion: plan.version }) : await api.createPlan(body);
    if (result.ok) onSaved(result.data);
    else setFailure(result.code === "VERSION_CONFLICT" ? t("field.errors.versionConflict") : t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }));
  };
  return (
    <Card title={plan ? t("field.plans.edit") : t("field.plans.new")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {failure && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{failure}</Alert>
          </div>
        )}
        <TextField label={t("field.plans.name")} value={input.name} error={err("name")} onChange={set("name")} />
        <SelectField label={t("field.plans.group")} value={input.targetGroupId} error={err("targetGroupId")} onChange={set("targetGroupId")}>
          <option value="">{t("field.plans.chooseGroup")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("field.list.type")} value={input.workType} onChange={set("workType")}>
          {WORK_ORDER_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`field.types.${type}`)}
            </option>
          ))}
        </SelectField>
        <TextField type="number" label={t("field.plans.intervalDays")} value={input.intervalDays} error={err("intervalDays")} onChange={set("intervalDays")} />
        <TextField type="number" label={t("field.plans.leadDays")} value={input.leadDays} error={err("leadDays")} onChange={set("leadDays")} />
        <TextField type="date" label={t("field.plans.nextDue")} value={input.nextDueOn} error={err("nextDueOn")} onChange={set("nextDueOn")} />
        <div className="sm:col-span-2">
          <TextArea label={t("field.plans.checklist")} value={input.checklistTemplate} error={err("checklistTemplate")} onChange={set("checklistTemplate")} />
        </div>
        <Checkbox label={t("field.plans.enabled")} checked={input.enabled} onChange={(e) => setInput((v) => ({ ...v, enabled: e.target.checked }))} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void submit()}>
          {t("common.save")}
        </Button>
      </div>
    </Card>
  );
}
