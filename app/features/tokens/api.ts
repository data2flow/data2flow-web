/**
 * 장기 토큰·서비스 계정 API(BFF `/bff/api/core/api-tokens`·`/service-accounts`, API-IAM-40~45). MCP 토큰 화면(API-AIA-09)도 같은 API를 `kind=MCP`로 쓴다.
 */
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import type { IssuedToken, ServiceAccount, TokenItem } from "./model";

type R<T> = Promise<BffJsonResult<T>>;
export type ListOf<T> = { responses: T[]; totalCount?: number; totalPages?: number; page?: number };

export interface TokenApi {
  list(query: { owner?: "me" | "all"; kind?: string; status?: string }): R<ListOf<TokenItem>>;
  issue(body: unknown): R<IssuedToken>;
  approve(id: string, reason?: string): R<void>;
  reject(id: string, reason?: string): R<void>;
  revoke(id: string): R<void>;
  rotate(id: string, graceHours: number): R<{ newTokenId: string; token: string }>;
  accounts(): R<ListOf<ServiceAccount>>;
  createAccount(body: { name: string; description?: string }): R<ServiceAccount>;
  disableAccount(id: string): R<ServiceAccount>;
}

const enc = encodeURIComponent;
const base = "/bff/api/core";

export const defaultTokenApi: TokenApi = {
  list: (q) => bffJson(`${base}/api-tokens?${new URLSearchParams({ size: "100", ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)) })}`),
  issue: (body) => bffJson(`${base}/api-tokens`, { method: "POST", body }),
  approve: (id, reason) => bffJson(`${base}/api-tokens/${enc(id)}/approve`, { method: "POST", body: { reason: reason ?? null } }),
  reject: (id, reason) => bffJson(`${base}/api-tokens/${enc(id)}/reject`, { method: "POST", body: { reason: reason ?? null } }),
  revoke: (id) => bffJson(`${base}/api-tokens/${enc(id)}`, { method: "DELETE" }),
  rotate: (id, graceHours) => bffJson(`${base}/api-tokens/${enc(id)}/rotate`, { method: "POST", body: { graceHours } }),
  accounts: () => bffJson(`${base}/service-accounts?size=100`),
  createAccount: (body) => bffJson(`${base}/service-accounts`, { method: "POST", body }),
  disableAccount: (id) => bffJson(`${base}/service-accounts/${enc(id)}/disable`, { method: "POST" }),
};
