import type { ReasonCode } from '@matta/core';

/** Plain Japanese for reason codes; mirrors policy/system-policy.yaml `ja` (static so it can render client-side). */
export const REASON_JA: Record<ReasonCode, string> = {
  authority_claim: '警察・役所・銀行などを名乗る相手からの指示の可能性',
  secrecy_requested: '口外しないよう言われている可能性',
  safe_account: '「保護口座」などへの移動の可能性',
  disable_protection_request: '見守り設定の解除を求められている可能性',
  on_call_with_instructor: '電話で指示を受けながら操作している可能性',
  guaranteed_returns: '元本保証・高利回りの勧誘',
  payee_name_flag: '受取人名義に公的機関・保護を思わせる語',
  guardian_unavailable: 'AIによる確認を完了できなかったため、念のため確認が必要',
  urgency: '急がされている',
  crypto_or_gold: '暗号資産・金地金の購入',
  coached_answers: '説明が誰かに用意されている可能性',
  inconsistent_story: '送金目的と受取人が一致しない',
  instructions_to_ai: 'AI宛ての指示を含む',
};

/** Japanese labels for mandate fields (classifier paths). */
export const FIELD_JA: Record<string, string> = {
  'everyday.registeredPayeeAutoMaxJpy': '登録済みの振込先へすぐ振り込める上限（1回）',
  'everyday.newPayeeAutoMaxJpy': '新しい振込先へすぐ振り込める上限（1回）',
  'everyday.dailyAutoTotalMaxJpy': 'すぐに振り込める1日の合計',
  'contactRequired.newPayeeOverJpy': '新しい振込先で見守り人の承認が必要になる金額',
  'holds.holdHours': '保留時間',
  'holds.verifiedPayeeHoldHours': '銀行確認済みの振込先の保留時間',
  'holds.quietHours': '夜間の時間帯',
  'holds.contactDecisionWindowHours': '見守り人の判断を待つ時間',
  'changes.loosenCoolingOffHours': 'ルールをゆるめる変更が有効になるまでの時間',
  'changes.contactMayCosignLoosening': '見守り人の承認でゆるめる変更をすぐ有効にできる',
  contacts: '見守り人',
};
