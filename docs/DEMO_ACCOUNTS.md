# Demo accounts (private dev reference)

All fictional. Source of truth: `apps/demo-bank/src/seed.ts`. Bank codes: 9990 デモ銀行（架空）, 9991 アオネ信用金庫（架空）, 9992 ミナト銀行（架空）.

| Use | Bank | Branch | Account | Holder (kana) | Kind |
|---|---|---|---|---|---|
| L1 rent (registered: アオネ不動産管理（架空）) | 9990 | 101 | 1000001 | アオネフドウサンカンリ（カ | registered |
| L5 仕送り (registered: ヤマダ イチロウ（架空・実家）) | 9991 | 201 | 2000001 | ヤマダ イチロウ | registered |
| L4 中古車 dealer | 9990 | 102 | 3000001 | カ）アオネモータース | new |
| L3 立替 friend | 9992 | 301 | 3000002 | スズキ タロウ | new |
| utility (gas) | 9990 | 103 | 3000003 | アオネガス（カ | new |
| L2 university | 9991 | 202 | 4000001 | ガク）アオネダイガク | verified |
| utility (electricity) | 9990 | 104 | 4000002 | アオネデンリヨク（カ | verified |
| S1 fake police | 9992 | 302 | 5000001 | タナカ ケンジ | new |
| S1c protection account | 9992 | 303 | 5000002 | ホゴカンリ（カ | new (keyword flag → contact) |
| S2 fake billing | 9991 | 203 | 5000003 | カ）サイトカンリセンター | new |
| S3 refund | 9992 | 304 | 5000004 | カンプキンジムキヨク | new |
| S4 investment | 9991 | 204 | 5000005 | カ）ブルーリッジアセット | new |

Per sandbox (sandbox-1..3): customer 山田 花子（デモ） `customer-N`, ¥4,800,000, phone 090-0000-000N（架空）; contact 山田 美咲（姉） `contact-N`; mandate v1 = SPEC §4 defaults.
