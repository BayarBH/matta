import Link from 'next/link';
import { formatJst, type ContactTransferView, type PayeeKind, type TransferStatus } from '@matta/core';
import { REASON_JA } from '@/lib/reasonCodes';

/**
 * Trusted surface (governance rule 6): every value here comes from bank data, never from LLM text.
 * Accepts the full Transfer or the contact's limited view.
 */
const KIND_JA: Record<PayeeKind, string> = { new: '新しい振込先', registered: '登録済み', verified: '銀行確認済み' };
const STATUS_JA: Record<TransferStatus, string> = {
  settled: '振込済み',
  held: '保留中',
  contact_required: '見守り人の承認待ち',
  cancelled: '取消済み',
  branch_review: '窓口での本人確認',
};
const STATUS_STYLE: Record<TransferStatus, string> = {
  settled: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  held: 'bg-amber-50 text-amber-900 border-amber-200',
  contact_required: 'bg-sky-50 text-sky-900 border-sky-200',
  cancelled: 'bg-stone-100 text-stone-600 border-stone-200',
  branch_review: 'bg-stone-100 text-stone-800 border-stone-300',
};

export const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

function headline(t: ContactTransferView): string | null {
  if (t.status === 'held' && t.holdUntil) {
    const hours = Math.round((Date.parse(t.holdUntil) - Date.parse(t.createdAt)) / 3_600_000);
    return `このお振込みは、あなたが決めたルールにより${hours}時間保留されます。`;
  }
  if (t.status === 'contact_required') return 'このお振込みは、見守り人の承認が必要です。承認されるまで、お金は口座から出ません。';
  if (t.status === 'branch_review') return '見守り人の判断が期限内に届かなかったため、窓口での本人確認が必要です。お金は口座から出ていません。';
  return null;
}

export function TransferFacts({ t }: { t: ContactTransferView }) {
  const head = headline(t);
  return (
    <section aria-label="振込の内容（銀行のデータ）" className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold tabular-nums">{yen(t.amountJpy)}</p>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_JA[t.status]}</span>
      </div>
      {head && (
        <div className={`rounded-lg border px-3 py-2.5 ${STATUS_STYLE[t.status]}`}>
          <p className="font-medium">{head}</p>
          <p className="mt-1 text-xs opacity-80">あなたのルール：{t.explanationJa}</p>
        </div>
      )}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-stone-500">受取人</dt>
        <dd>
          {t.payee.holderNameKana}
          {t.payee.displayName && <span className="text-stone-500">（{t.payee.displayName}）</span>}
          <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{KIND_JA[t.payee.payeeKind]}</span>
        </dd>
        <dt className="text-stone-500">口座</dt>
        <dd className="tabular-nums">
          {t.payee.bankCode}-{t.payee.branchCode}-{t.payee.accountNumber}
        </dd>
        {!head && (
          <>
            <dt className="text-stone-500">あなたのルール</dt>
            <dd>{t.explanationJa}</dd>
          </>
        )}
        <dt className="text-stone-500">受付</dt>
        <dd className="tabular-nums">{formatJst(t.createdAt)}</dd>
        {t.status === 'held' && t.holdUntil && (
          <>
            <dt className="text-stone-500">保留期限</dt>
            <dd className="tabular-nums">{formatJst(t.holdUntil)}</dd>
          </>
        )}
      </dl>
      {t.releaseConditionsJa.length > 0 && (
        <div>
          <p className="text-stone-500">お金が出る条件</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {t.releaseConditionsJa.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {(t.flags.length > 0 || t.escalationReasons.length > 0) && (
        <div>
          <p className="text-stone-500">確認が必要な理由</p>
          <ul className="mt-1 space-y-0.5">
            {t.flags.map((f, i) => (
              <li key={`f${i}`}>
                ・{REASON_JA[f.code]}
                {f.quote && <span className="text-stone-500">（「{f.quote}」）</span>}
              </li>
            ))}
            {t.escalationReasons.map((c) => (
              <li key={c}>・{REASON_JA[c]}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Only the customer's full Transfer carries customerUid; contacts' limited view gets no audit link. */}
      {'customerUid' in t && (
        <Link href={`/audit/${t.id}`} className="inline-block text-xs text-teal-800 underline underline-offset-2">
          ブラックボックスを見る
        </Link>
      )}
    </section>
  );
}
