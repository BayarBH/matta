import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'マッタ｜デモ銀行（架空）',
  description: '送金に「待った」をかける見守りエージェント（架空のデモ）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-stone-50 text-stone-800">
        <div role="note" className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900">
          架空のデモです。実在の銀行・警察とは関係ありません。
        </div>
        <header className="border-b border-stone-200 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold tracking-wide">マッタ｜デモ銀行（架空）</h1>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
