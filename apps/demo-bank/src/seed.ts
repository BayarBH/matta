import { defaultTerms, type Mandate } from '@matta/core';
import { hashObject } from '@matta/core/node';
import type { Store } from './store';

/** Fictional accounts. Bank codes 9990–9992 are デモ銀行（架空） and two other fictional banks. */
export const DIRECTORY = [
  // registered payees (every sandbox)
  { bankCode: '9990', branchCode: '101', accountNumber: '1000001', holderNameKana: 'アオネフドウサンカンリ（カ', category: 'registered:rent' },
  { bankCode: '9991', branchCode: '201', accountNumber: '2000001', holderNameKana: 'ヤマダ イチロウ', category: 'registered:family' },
  // legitimate, new
  { bankCode: '9990', branchCode: '102', accountNumber: '3000001', holderNameKana: 'カ）アオネモータース', category: 'legit:L4 used car' },
  { bankCode: '9992', branchCode: '301', accountNumber: '3000002', holderNameKana: 'スズキ タロウ', category: 'legit:L3 立替' },
  { bankCode: '9990', branchCode: '103', accountNumber: '3000003', holderNameKana: 'アオネガス（カ', category: 'legit:utility' },
  // verified (bank-maintained registry)
  { bankCode: '9991', branchCode: '202', accountNumber: '4000001', holderNameKana: 'ガク）アオネダイガク', category: 'verified:L2 university' },
  { bankCode: '9990', branchCode: '104', accountNumber: '4000002', holderNameKana: 'アオネデンリヨク（カ', category: 'verified:utility' },
  // scam accounts (red-team scenarios)
  { bankCode: '9992', branchCode: '302', accountNumber: '5000001', holderNameKana: 'タナカ ケンジ', category: 'scam:S1 fake police' },
  { bankCode: '9992', branchCode: '303', accountNumber: '5000002', holderNameKana: 'ホゴカンリ（カ', category: 'scam:S1c protection account' },
  { bankCode: '9991', branchCode: '203', accountNumber: '5000003', holderNameKana: 'カ）サイトカンリセンター', category: 'scam:S2 fake billing' },
  { bankCode: '9992', branchCode: '304', accountNumber: '5000004', holderNameKana: 'カンプキンジムキヨク', category: 'scam:S3 refund' },
  { bankCode: '9991', branchCode: '204', accountNumber: '5000005', holderNameKana: 'カ）ブルーリッジアセット', category: 'scam:S4 investment' },
] as const;

export const BANK_NAMES: Record<string, string> = { '9990': 'デモ銀行（架空）', '9991': 'アオネ信用金庫（架空）', '9992': 'ミナト銀行（架空）' };

export const accountKey = (a: { bankCode: string; branchCode: string; accountNumber: string }) => `${a.bankCode}-${a.branchCode}-${a.accountNumber}`;

const REGISTERED = [
  { key: '9990-101-1000001', displayName: 'アオネ不動産管理（架空）' },
  { key: '9991-201-2000001', displayName: 'ヤマダ イチロウ（架空・実家）' },
];

/** Global directory + verified registry. Idempotent. */
export async function seedDirectory(store: Store): Promise<void> {
  for (const d of DIRECTORY) {
    const key = accountKey(d);
    await store.set('directory', key, {
      key,
      bankCode: d.bankCode,
      branchCode: d.branchCode,
      accountNumber: d.accountNumber,
      holderNameKana: d.holderNameKana,
      bankNameJa: BANK_NAMES[d.bankCode]!,
    });
    if (d.category.startsWith('verified')) await store.set('verifiedPayees', key, { key });
  }
}

const SANDBOX_SCOPED = ['transfers', 'ledger', 'mandateChanges', 'contactDecisions', 'bankAudit', 'payees'];

/** Wipes and reseeds one sandbox (also used by POST /demo/sandboxes/:sid/reset). */
export async function seedSandbox(store: Store, sid: string, now = new Date()): Promise<void> {
  const n = sid.replace('sandbox-', '');
  const customerUid = `customer-${n}`;
  const contactUid = `contact-${n}`;

  for (const col of SANDBOX_SCOPED) {
    for (const d of await store.where(col, 'sandboxId', sid)) await store.del(col, String(d.id));
  }
  for (const d of await store.all(`mandates/${sid}/versions`)) await store.del(`mandates/${sid}/versions`, String(d.version));

  await store.set('sandboxes', sid, { id: sid, clockOffsetMs: 0, customerUid, contactUids: [contactUid] });
  await store.set('accounts', sid, {
    sandboxId: sid,
    customerUid,
    displayName: '山田 花子（デモ）',
    balanceJpy: 4_800_000,
    phoneJa: `090-0000-000${n}（架空）`,
  });
  for (const p of REGISTERED) {
    const id = `${sid}-${p.key}`;
    await store.set('payees', id, { id, sandboxId: sid, key: p.key, displayName: p.displayName });
  }
  const terms = defaultTerms({ uid: contactUid, displayName: '山田 美咲', relation: '姉' });
  const mandate: Mandate = { ...terms, version: 1, signedAt: now.toISOString(), signedBy: customerUid, hash: hashObject(terms) };
  await store.set(`mandates/${sid}/versions`, '1', mandate);
  await store.set('mandates', sid, { sandboxId: sid, activeVersion: 1 });
}

export const SANDBOXES = ['sandbox-1', 'sandbox-2', 'sandbox-3'];
