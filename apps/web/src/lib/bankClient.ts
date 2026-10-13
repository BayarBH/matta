'use client';
import type { z } from 'zod';
import { clientAuth } from './firebase.client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function call<S extends z.ZodType>(url: string, init: RequestInit, schema: S, tokenHeader: string, forceRefresh: boolean) {
  const user = clientAuth().currentUser;
  if (!user) throw new ApiError(401, 'signed_out');
  const token = await user.getIdToken(forceRefresh);
  const headers = new Headers(init.headers);
  headers.set(tokenHeader, tokenHeader === 'authorization' ? `Bearer ${token}` : token);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof json === 'object' && json && 'error' in json ? String(json.error) : 'error';
    throw new ApiError(res.status, code);
  }
  return schema.parse(json) as z.infer<S>;
}

/** Browser → bank directly (C/K routes), Firebase ID token in X-User-Token. */
export const bankFetch = <S extends z.ZodType>(path: string, init: RequestInit, schema: S, opts: { forceRefresh?: boolean } = {}) =>
  call(new URL(path, process.env.NEXT_PUBLIC_BANK_URL).toString(), init, schema, 'x-user-token', opts.forceRefresh ?? false);

/** Browser → web API (W+C routes forwarded as sa-web). */
export const webFetch = <S extends z.ZodType>(path: string, init: RequestInit, schema: S) =>
  call(path, init, schema, 'authorization', false);

export const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

/** Calm Japanese message for an API error. */
export function errorJa(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'reauth_required') return '安全のため、パスワードをもう一度入力してください。';
    if (e.code === 'insufficient_balance') return '残高が足りません。';
    if (e.code === 'no_change') return '変更はありませんでした。';
    if (e.code === 'cosign_disabled') return 'このルールでは、見守り人の承認ですぐに有効にすることはできません。';
    if (e.status === 401) return 'ログインの有効期限が切れました。もう一度ログインしてください。';
    if (e.status === 403) return 'この操作は行えません。';
    if (e.status === 404) return '見つかりませんでした。';
    if (e.status === 409) return 'すでに状態が変わっています。画面を更新してください。';
    if (e.status === 400) return '入力内容をご確認ください。';
  }
  return '通信に失敗しました。時間をおいてもう一度お試しください。';
}
