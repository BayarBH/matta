import Link from 'next/link';

export const metadata = { title: '審査員ガイド｜マッタ（架空のデモ）' };

const STEPS = [
  {
    title: 'customer-N でログインして、ルールと残高を確認',
    body: '「見守りルール」が、落ち着いているときに本人が決めた契約です。家賃など日常の振込はすぐに通ります（例：アオネ不動産管理へ 85,000円）。',
  },
  {
    title: '2つ目のウィンドウで contact-N にログインし、/demo で S1 を開始',
    body: '同じ番号の見守り人でログインしてください（例：customer-1 と contact-1）。見守り人のログインが難しい場合は「自動シミュレーション」をオンにすると、一人でも最後まで進みます。',
  },
  {
    title: 'ブラックボックスで全記録を確認',
    body: '振込の「ブラックボックスを見る」から、アプリと銀行の両方で起きたことを時系列で確認できます。AIが送金を実行した記録は 0 件です。',
  },
];

/** Public judge guide (no login). */
export default function GuidePage() {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-stone-500">審査員ガイド</p>
        <h2 className="text-2xl font-semibold leading-snug">冷静なあなたが決めたルールで、焦っているあなたを守る。</h2>
        <p className="text-stone-600">ネットバンキングに、窓口の“ひと声”を。</p>
      </header>

      <p className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 font-medium text-teal-950">
        AIは止められるが、通せない。 — お金を動かせるのは、本人が決めたルールと、あらかじめ選んだ見守り人だけです。
      </p>

      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">{i + 1}</span>
            <div className="space-y-1">
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-stone-600">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="space-y-1 text-sm text-stone-600">
        <p>テスト用アカウントのメールアドレスは customer-1@matta-demo.example 〜 customer-3、contact-1 〜 contact-3、operator です。パスワードは応募フォームに記載しています。</p>
        <p>同時に審査される場合は、別々の番号のアカウントをお使いください。</p>
      </section>

      <Link href="/login" className="inline-block rounded bg-teal-700 px-4 py-2 text-white hover:bg-teal-800">
        ログインへ
      </Link>
    </article>
  );
}
