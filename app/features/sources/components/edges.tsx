/**
 * 엣지 게이트웨이 화면 부품(UI-DSC-10, DSC-08.03): 목록(이름·사이트·상태·버전(업데이트 가능)·버퍼·처리량·마지막 연결·설정 판),
 * 등록 결과 1회 표시(토큰·설치 명령·오프라인 패키지, 24시간), 설정 판(편집·배포·롤백·결과), 업데이트 승인.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, SelectField, Table, TextArea } from "~/components/ui";
import { formatDateTime, formatRelative } from "~/lib/format";
import { DEFAULT_CONFIG, bufferPercent, compactCount, edgeTone, parseConfigVersion, type EdgeConfigVersion, type EdgeGateway, type EdgeRegistration, type EdgeUpdates } from "../model/edge";

export function EdgeStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge tone={edgeTone(status)}>{t(`sources.edges.status.${status}`, { defaultValue: status })}</Badge>;
}

export function EdgeList({ edges, now, lang }: { edges: EdgeGateway[]; now: number; lang: string }) {
  const { t } = useTranslation();
  if (edges.length === 0) return <EmptyState title={t("sources.edges.empty")} body={t("sources.edges.emptyBody")} />;
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">{t("sources.edges.name")}</th>
          <th scope="col">{t("sources.edges.site")}</th>
          <th scope="col">{t("sources.edges.state")}</th>
          <th scope="col">{t("sources.edges.version")}</th>
          <th scope="col">{t("sources.edges.buffer")}</th>
          <th scope="col">{t("sources.edges.throughput")}</th>
          <th scope="col">{t("sources.edges.lastSeen")}</th>
          <th scope="col">{t("sources.edges.config")}</th>
        </tr>
      </thead>
      <tbody>
        {edges.map((e) => {
          const pct = bufferPercent(e.bufferUsedBytes);
          return (
            <tr key={e.id}>
              <td>
                <Link to={`/sources/edges/${encodeURIComponent(e.id)}`} className="font-medium text-accent hover:underline">
                  {e.name}
                </Link>
              </td>
              <td>{e.site?.name ?? "–"}</td>
              <td>
                <EdgeStatus status={e.status} />
              </td>
              <td className="font-mono">
                {e.agentVersion ?? "–"} {e.updateAvailable && <Badge tone="info">{t("sources.edges.updateTo", { version: e.latestAgentVersion ?? "" })}</Badge>}
              </td>
              <td className="font-mono">{pct === null ? "–" : `${pct}% (${compactCount(e.bufferItems)})`}</td>
              <td className="font-mono">{e.throughput === null || e.throughput === undefined ? "–" : t("sources.edges.perMin", { n: Math.round(e.throughput) })}</td>
              <td>{formatRelative(e.lastSeenAt, now, lang)}</td>
              <td className="font-mono">{e.appliedConfigVersion ? `v${e.appliedConfigVersion}` : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** 등록 토큰 1회 표시(BR-DSC-31: 24시간·1회용) */
export function EdgeRegistrationCard({ registration, timezone, lang }: { registration: EdgeRegistration; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Card title={t("sources.edges.registered", { name: registration.name })}>
      <div className="flex flex-col gap-2 text-[13px]">
        <Alert tone="warning">{t("sources.edges.tokenOnce", { at: formatDateTime(registration.expiresAt, timezone, lang) })}</Alert>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t("sources.edges.token")}</span>
          <code className="break-all font-mono" data-testid="edge-token">
            {registration.registrationToken}
          </code>
          <Button variant="ghost" onClick={() => copy(registration.registrationToken)}>
            {copied ? t("sources.webhook.copied") : t("sources.edges.copyToken")}
          </Button>
        </div>
        {registration.installCommand && (
          <>
            <p className="text-muted">{t("sources.edges.install")}</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[12px]">{registration.installCommand}</pre>
          </>
        )}
        {registration.offlinePackageUrl && (
          <a href={registration.offlinePackageUrl} className="text-accent hover:underline">
            {t("sources.edges.offlinePackage")}
          </a>
        )}
        <div>
          <Link to={`/sources/edges/${encodeURIComponent(registration.id)}`} className="text-accent hover:underline">
            {t("sources.edges.toDetail")}
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function ConfigVersions({ versions, canAdmin, timezone, lang }: { versions: EdgeConfigVersion[]; canAdmin: boolean; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const latest = versions.length ? JSON.stringify({ targets: versions[0].targets, decoders: versions[0].decoders }, null, 2) : DEFAULT_CONFIG;
  const [draft, setDraft] = useState(latest);
  const parsed = parseConfigVersion(draft);
  return (
    <div className="flex flex-col gap-4">
      <Card title={t("sources.edges.versions")}>
        {versions.length === 0 ? (
          <p className="text-[13px] text-muted">{t("sources.edges.noVersions")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t("sources.edges.versionNo")}</th>
                <th scope="col">{t("sources.edges.targets")}</th>
                <th scope="col">{t("sources.edges.result")}</th>
                <th scope="col">{t("sources.edges.deployedAt")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td className="font-mono">
                    v{v.version} {v.applied && <Badge tone="success">{t("sources.edges.applied")}</Badge>} {v.desired && !v.applied && <Badge tone="info">{t("sources.edges.desired")}</Badge>}
                  </td>
                  <td className="font-mono text-[12px]">{Array.isArray(v.targets) ? v.targets.map((x) => (x as { connectorKey?: string }).connectorKey ?? "?").join(", ") : "–"}</td>
                  <td>
                    {v.result ? <Badge tone={v.result === "APPLIED" ? "success" : v.result.startsWith("FAILED") ? "danger" : "neutral"}>{t(`sources.edges.resultOf.${v.result}`, { defaultValue: v.result })}</Badge> : "–"}
                    {v.error && <span className="ml-1 text-[12px] text-bad-ink">{v.error}</span>}
                  </td>
                  <td>{v.deployedAt ? formatDateTime(v.deployedAt, timezone, lang) : "–"}</td>
                  <td>
                    {canAdmin && (
                      <Form method="post" className="flex gap-2">
                        <CsrfField />
                        <input type="hidden" name="version" value={v.version} />
                        {!v.desired && (
                          <Button type="submit" name="intent" value="deploy">
                            {t("sources.edges.deploy")}
                          </Button>
                        )}
                        {!v.applied && v.version !== versions[0].version && (
                          <Button type="submit" name="intent" value="rollback" variant="ghost">
                            {t("sources.edges.rollback")}
                          </Button>
                        )}
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {canAdmin && (
        <Card title={t("sources.edges.newVersion")}>
          <Form method="post" className="flex flex-col gap-2">
            <CsrfField />
            <TextArea label={t("sources.edges.configJson")} name="config" value={draft} spellCheck={false} error={parsed.ok ? undefined : t(`sources.edges.error.${parsed.error}`)} onChange={(e) => setDraft(e.target.value)} />
            <p className="text-[12px] text-muted">{t("sources.edges.configHint")}</p>
            <div>
              <Button type="submit" name="intent" value="createConfig" variant="primary" disabled={!parsed.ok}>
                {t("sources.edges.saveVersion")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}

export function EdgeUpdatesPanel({ updates, canAdmin, timezone, lang }: { updates: EdgeUpdates | null; canAdmin: boolean; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const [toVersion, setToVersion] = useState(updates?.latestVersion ?? updates?.availableVersions[0] ?? "");
  if (!updates) return <Alert tone="warning">{t("sources.edges.updatesFailed")}</Alert>;
  return (
    <Card title={t("sources.edges.updates")}>
      <p className="mb-2 text-[13px]">{t("sources.edges.currentLatest", { current: updates.currentVersion ?? "–", latest: updates.latestVersion ?? "–" })}</p>
      {canAdmin && updates.availableVersions.length > 0 && (
        <Form method="post" className="mb-3 flex flex-wrap items-end gap-2">
          <CsrfField />
          <SelectField label={t("sources.edges.toVersion")} name="toVersion" value={toVersion} onChange={(e) => setToVersion(e.target.value)}>
            {updates.availableVersions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </SelectField>
          <Button type="submit" name="intent" value="approveUpdate" variant="primary">
            {t("sources.edges.approve")}
          </Button>
        </Form>
      )}
      {updates.updates.length === 0 ? (
        <p className="text-[13px] text-muted">{t("sources.edges.noUpdates")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-[13px]">
          {updates.updates.map((u) => (
            <li key={u.updateId}>
              <span className="font-mono">
                {u.fromVersion ?? "?"} → {u.toVersion}
              </span>{" "}
              <Badge tone={u.status === "SUCCEEDED" ? "success" : u.status.startsWith("FAILED") ? "danger" : "info"}>{t(`sources.edges.updateStatus.${u.status}`, { defaultValue: u.status })}</Badge> <span className="text-muted">{u.createdAt ? formatDateTime(u.createdAt, timezone, lang) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
