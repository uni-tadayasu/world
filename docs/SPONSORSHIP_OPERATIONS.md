# スポンサー掲載枠の販売・掲載管理

更新日: 2026-11-25

## 現在の状態

スポンサー募集ページ、販売条件のページ、支払通知の受信処理、注文台帳、掲載審査、掲載期間の管理を実装しています。**本番購入は停止中です。** 販売者の公開情報と実際の税の取扱いが確認できていないため、Stripeの商品・価格・Payment Link・Webhookをまだ本番登録していません。実際のスポンサー購入や売上は確認しておらず、この実装で資金を獲得したことにはなりません。

公開ページは `/sponsors.html`、掲載規約は `/sponsor-terms.html`、販売者情報は `/commerce.html` です。ゲーム内のメニュー・設定とトップページに導線があります。購入者やプレイヤーのログインは追加していません。管理者の画面 `/sponsor-admin.html` は、別に設定する管理キーでAPIを保護します。

## 提供する掲載枠

| 項目 | 初期仕様 |
| --- | --- |
| プランID | `sponsor-directory-30d-v1` |
| 販売予定価格 | 1回・支払総額3,300円。税の取扱いは販売開始前に確認 |
| 掲載場所 | 公開スポンサー一覧のカード。ゲームのメニュー等から同じ一覧へ移動 |
| 掲載内容 | 名称60字以内、紹介文80字以内、公開HTTPSサイトへのリンク |
| 掲載期間 | 支払照合と運営審査の承認後から連続30日間 |
| 審査期限 | 支払確認から7暦日。期限を過ぎた未承認注文は返金対応 |
| 更新 | なし。再購入は別の単発注文 |
| 共有枠 | 他のスポンサーと同じ一覧に掲載。独占枠や順番の固定はなし |
| 成果保証 | 表示回数・クリック数・成約数・検索順位・広告収益を保証しない |
| 含まないもの | 3D街内の看板、BTC・ゲーム内資金の購入、配当・出資・投資・報酬受給権 |

現在のページは「販売準備中」と表示し、有効な決済リンクを返しません。架空のスポンサーは実績として掲載せず、見本は掲載イメージと明示します。

## 注文と掲載

1. 販売開始後、購入者は商品説明・規約・販売者情報を確認し、Stripeのホスト型Checkoutへ移動します。
2. Checkoutのカスタム項目で、公開を希望する名称・紹介文・HTTPSリンクを受け取ります。連絡用メールはStripe側で管理し、ゲームのサーバーに保存せず、掲載一覧にも公開しません。
3. サーバーはStripeの署名済み通知を検証し、指定したPayment Link・商品識別情報・通貨・金額の注文だけを受け付けます。
4. Checkoutの支払完了と同じPaymentIntentの決済記録を照合します。支払待ちの通知や、戻り先URLのパラメーターだけでは公開しません。
5. 管理者が内容とリンクを審査して承認すると、掲載開始と30日後の終了日時を一度だけ確定します。再送された承認で延長しません。
6. 公開一覧は、支払・照合済み、承認済み、保留なし、掲載期間内の注文だけを返します。

返金・異議申立ての通知は、注文の到着順に依存せず保留へ反映します。販売を停止した後も、署名設定が残っていれば既存の取引通知を受けられます。購入ボタンを有効にする設定と、取引通知を受ける設定は別です。

## 返金と問い合わせ

掲載前の購入者都合の取消、審査不承認、7日以内に承認できなかった注文、運営が掲載を提供できない場合は全額返金の対象です。掲載開始後の購入者都合の返金は、法令上必要な場合を除いて受け付けません。公開条件の詳細は販売者情報と掲載規約の両方に記載します。

**返金送金は自動実行しません。** 管理画面で拒否しただけでは返金になりません。管理者がStripe Dashboardで実際の決済を照合して返金を操作し、Stripeの通知で状態を確認します。失敗・保留になった返金は、管理者が問い合わせ対応を継続します。実運用前に、購入者へ回答できるメール、表示内容の審査、返金を処理する担当者を確保してください。

## 設定

秘密の値はSitesの本番環境変数として保存し、リポジトリ、静的ファイル、ブラウザのコード、ログ、URLには含めません。

| 環境変数 | 用途 |
| --- | --- |
| `SPONSOR_SALES_ENABLED` | すべての準備と確認の後に `true`。単独では購入を有効化しない |
| `SPONSOR_TAX_REVIEWED` | 実際の税の取扱いと決済の税設定を確認した後に `true` |
| `SPONSOR_MERCHANT_JSON` | 公開用の販売者情報。下記の必須項目を含む |
| `SPONSOR_STRIPE_ACCOUNT_ID` | この広告販売に使うStripeアカウントID |
| `SPONSOR_STRIPE_PAYMENT_LINK_ID` | このプラン専用のPayment Link ID |
| `SPONSOR_STRIPE_PAYMENT_LINK_URL` | Stripeが発行した `https://buy.stripe.com/` のURL |
| `SPONSOR_STRIPE_WEBHOOK_SECRET` | 対応するWebhookの署名検証シークレット。秘密として保存 |
| `SPONSOR_ADMIN_TOKEN` | 十分にランダムな32文字以上の管理キー。秘密として保存 |

`SPONSOR_MERCHANT_JSON` は `sellerName`（正式な販売事業者名）、`representative`（運営責任者）、`address`、`phone`、`email`、`paymentMethods`（実際に使う支払方法の表示名の配列）、`paymentTiming`（各支払方法の時期）を必要とします。問い合わせページがある場合は `contactUrl` も設定できます。このJSONは公開される情報です。本人確認や銀行手続用の非公開情報を、そのまま流用しないでください。空欄や「確認中」などで購入を有効にしません。

管理キーは管理画面でその都度入力し、メモリー内だけに保持します。保存領域・URLには保存せず、画面の再読込時には再入力を求めます。管理者は自分の安全な認証情報管理手段で保管してください。キーを設定することは、ゲームに会員登録を復活させることではありません。

## 本番接続の手順

これは未実施の接続手順です。実施したとの記録や、契約の成立を意味しません。

1. 公開可能な正式な販売者情報と連絡先を確認します。`/commerce.html` に表示する情報を、運営者自身の事実として確定します。
2. 消費税等を徴収するか、Stripe Taxを使うか、既存の税登録・税設定を確認します。自動税計算を使う場合は実際の登録・商品区分を確認し、必要な検証を行います。未確認の課税義務や税コードを推測して登録しません。
3. この商品専用のProductと単発Priceを作成し、Payment Linkを用意します。数量は1で変更不可、割引・送料・自動更新なし、支払総額は3,300円。実際の支払方法と税の設定が仕様に合うことを照合します。共通アカウントの既存商品や支払設定を書き換えません。
4. Payment LinkのmetadataとPaymentIntent用metadataに `offer: sponsor-directory-30d-v1` を設定し、カスタム項目のキーを `sponsor_name`・`sponsor_url`・`sponsor_message` に固定します。氏名やメールを広告掲載名と混同しない表示を付けます。
5. 規約への同意と、販売者情報・返金条件・提供期限が購入時に確認できるよう設定します。購入後の戻り先は、公開済みWorkerの `/sponsors.html?session_id={CHECKOUT_SESSION_ID}` とします。カスタムドメインが有効になるまではネイティブの公開URLを使用します。
6. `/api/sponsors/stripe-webhook` にWebhookを登録し、署名シークレットをSitesへ安全に保存します。対象イベントは `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`charge.succeeded`、`charge.updated`、`charge.refunded`、`refund.created`、`refund.updated`、`refund.failed`、`charge.dispute.created`、`charge.dispute.updated`、`charge.dispute.closed` です。
7. 本番とは別のStripe sandboxで、支払・遅延成功・失敗・返金・重複・審査・期限切れを確認します。本番アカウントへ架空の購入・入金を記録せず、実際の課金で試験しません。
8. 管理者のアクセスと審査・返金運用を確認し、すべての環境設定を整えて同じソースを公開します。公開ページとStripe側の有効状態を照合してから、購入受付を開始します。

署名の秘密や内部注文IDが有効な決済通知の代わりにはなりません。クライアントから `paid: true` などを受け取る入口は設けません。

## 売上と原資の扱い

スポンサーの注文・売上は `sponsor_*` の台帳に記録します。Stripeの決済成功は、銀行口座への着金や自由に送金できる残高を保証しません。決済手数料、返金、異議申立て、税、運営費などを確認する必要があります。

`exchange_sandbox_*` の価値のない検証残高、`exchange_*` の報酬、`reward_treasury_*` のBTC原資はそれぞれ別です。この広告のWebhookからBTCを生成・購入・送金・入金計上する処理はありません。円からBTCを用意する取引、確認済み入金、報酬の運営条件、送金先は別に整える必要があります。広告購入が発生する前に将来売上を「確保済み」と表示しません。

## 検証と限界

自動テストは合成した署名済みイベントとローカルSQLiteを使います。Stripeの本番支払、銀行入金、Stripe Taxの計算、広告主への送信や実際の広告購入を実行した試験ではありません。本番接続が完了したとの主張には、環境設定とStripe側の登録、別sandboxでの実接続確認が別途必要です。

## 参照資料

- [Stripe：Payment Linksの購入後の処理](https://docs.stripe.com/payment-links/post-payment)
- [Stripe：Checkoutのfulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe：Webhook署名の検証](https://docs.stripe.com/webhooks#verify-events)
- [Stripe Japan：特定商取引法に基づく表記](https://support.stripe.com/questions/how-to-create-and-display-a-commerce-disclosure-page?locale=ja-JP)
- [消費者庁：通信販売](https://www.no-trouble.caa.go.jp/what/mailorder/)
- [消費者庁：通信販売広告Q&A](https://www.no-trouble.caa.go.jp/qa/advertising.html-2)

この文書は法的登録・税務判断・Stripeの個別審査承認を証明するものではありません。
