/**
 * 토픽 템플릿 도우미(DSC-09.08, BR-DSC-28): 템플릿과 표본 토픽을 넣으면 뽑힌 값(기기 ID·공간·측정 항목)을 바로 보여 주고,
 * [디코더에 적용]으로 기기 ID·측정 항목 위치를 디코더 설정의 토픽 참조로 옮긴다. 맞지 않는 토픽은 "미처리"로 표시한다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, TextField } from "~/components/ui";
import { applyTopicRefs, matchTopic, parseTopicTemplate, roleOf, subscriptionFilter, topicRefs } from "../model/topic-template";

export function TopicTemplateHelper({ decoderKey, decoderConfig, sampleTopic = "", readOnly, onApply }: { decoderKey: string; decoderConfig: string; sampleTopic?: string; readOnly?: boolean; onApply: (config: string) => void }) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState("");
  const [sample, setSample] = useState(sampleTopic);
  const parsed = template.trim() ? parseTopicTemplate(template) : null;
  const levels = parsed?.ok ? parsed.levels : null;
  const values = levels && sample.trim() ? matchTopic(levels, sample.trim()) : null;
  const refs = levels ? topicRefs(levels) : null;
  const canApply = Boolean(levels && refs?.deviceIdFrom && (decoderKey === "generic-json" || decoderKey === "single-value"));
  return (
    <section aria-label={t("sources.topicTemplate.title")} className="flex flex-col gap-2 rounded-md border border-line p-3">
      <p className="text-[12.5px] font-semibold">{t("sources.topicTemplate.title")}</p>
      <p className="text-[12px] text-muted">{t("sources.topicTemplate.hint")}</p>
      <div className="grid gap-2 md:grid-cols-2">
        <TextField label={t("sources.topicTemplate.template")} value={template} placeholder="site/{site}/room/{room}/{deviceId}/{metric}" error={parsed && !parsed.ok ? t(`sources.topicTemplate.error.${parsed.error}`, { n: (parsed.level ?? 0) + 1 }) : undefined} readOnly={readOnly} onChange={(e) => setTemplate(e.target.value)} />
        <TextField label={t("sources.topicTemplate.sample")} value={sample} placeholder="site/gwangju/room/301/em300-01/temperature" onChange={(e) => setSample(e.target.value)} />
      </div>
      {levels && <p className="font-mono text-[12px] text-muted">{t("sources.topicTemplate.filter", { filter: subscriptionFilter(levels) })}</p>}
      {levels && sample.trim() && !values && (
        <p role="status" className="text-[12.5px] text-fair-ink">
          {t("sources.topicTemplate.unmatched")}
        </p>
      )}
      {values && (
        <table className="text-[12.5px]" aria-label={t("sources.topicTemplate.result")}>
          <tbody>
            {Object.entries(values).map(([name, v]) => (
              <tr key={name}>
                <th scope="row" className="pr-3 text-left font-mono font-normal">{`{${name}}`}</th>
                <td className="pr-3 font-mono">{v}</td>
                <td>
                  <Badge tone={roleOf(name) === "device" ? "success" : roleOf(name) === "metric" ? "info" : "neutral"}>{t(`sources.topicTemplate.role.${roleOf(name)}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {levels && Object.keys(values ?? {}).some((n) => roleOf(n) === "space") && <p className="text-[12px] text-muted">{t("sources.topicTemplate.spaceNote")}</p>}
      {!readOnly && (
        <div>
          <Button onClick={() => levels && onApply(applyTopicRefs(decoderKey, decoderConfig, levels))} disabled={!canApply}>
            {t("sources.topicTemplate.apply")}
          </Button>
          {levels && !refs?.deviceIdFrom && <span className="ml-2 text-[12px] text-muted">{t("sources.topicTemplate.needDevice")}</span>}
          {levels && refs?.deviceIdFrom && !canApply && <span className="ml-2 text-[12px] text-muted">{t("sources.topicTemplate.needDecoder")}</span>}
        </div>
      )}
    </section>
  );
}
