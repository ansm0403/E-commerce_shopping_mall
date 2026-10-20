# API 표면과 요청 타입 대조 — 점검 분모

> `node scripts/security/list-api-surface.mjs` 와 `node scripts/security/compare-request-types.mjs` 의 출력(2026-10-20 — 미호출 라우트 점검으로 5개를 지운 뒤 재생성, 직전 생성은 2026-10-16: 라우트 112·미호출 18). 코드가 바뀌면 다시 생성한다. 해석은 [ex-security-api-boundary.md](./ex-security-api-boundary.md) §4·§6, 미호출 라우트의 분류는 §9.


- 클라이언트가 호출하는 API(메서드+경로 기준): **95개** (호출 지점 108곳)
- 그중 백엔드 라우트와 대응된 것: 95개 · 대응 안 됨: 0개
- 백엔드 전체 라우트: 107개 · 클라이언트가 부르지 않는 라우트: 13개

## 1. 클라이언트가 호출하는 API (= 점검 대상)

| # | 메서드 | 경로 | 가드 | 컨트롤러 | 호출 지점 |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/admin/assistant/conversations/:p/messages` | admin | AssistantController.getConversationMessages | frontend/src/service/admin-assistant.ts:63 |
| 2 | POST | `/admin/assistant/stream` | admin | AssistantController.stream | frontend/src/service/admin-assistant.ts:83 |
| 3 | POST | `/admin/assistant/stream/cancel` | admin | AssistantController.cancelStream | frontend/src/service/admin-assistant.ts:119 |
| 4 | GET | `/admin/dashboard/funnel` | admin | DashboardController.getFunnel | frontend/src/service/admin-dashboard.ts:104 |
| 5 | GET | `/admin/dashboard/kpi` | admin | DashboardController.getKpi | frontend/src/service/admin-dashboard.ts:37 |
| 6 | GET | `/admin/dashboard/order-trend` | admin | DashboardController.getOrderTrend | frontend/src/service/admin-dashboard.ts:42 |
| 7 | GET | `/admin/dashboard/security` | admin | DashboardController.getSecurity | frontend/src/service/admin-dashboard.ts:73 |
| 8 | GET | `/admin/audit-logs` | admin | AuditController.getAuditLogs | frontend/src/service/admin-audit.ts:59 |
| 9 | POST | `/auth/demo-login` | 공개 | AuthController.demoLogin | frontend/src/service/auth.ts:140 (+1) |
| 10 | GET | `/auth/demo-options` | 공개 | AuthController.demoOptions | frontend/src/service/auth.ts:145 |
| 11 | GET | `/auth/demo-status` | 로그인 | AuthController.demoStatus | frontend/src/service/auth.ts:148 |
| 12 | POST | `/auth/login` | 공개 | AuthController.login | frontend/src/app/api/auth/login/route.ts:10 (+2) |
| 13 | POST | `/auth/logout` | 로그인 | AuthController.logout | frontend/src/app/api/auth/logout/route.ts:13 (+3) |
| 14 | GET | `/auth/me` | 로그인 | AuthController.getMe | frontend/src/service/auth.ts:57 (+1) |
| 15 | POST | `/auth/refresh` | 공개 | AuthController.refresh | frontend/src/app/api/auth/refresh/route.ts:15 (+3) |
| 16 | POST | `/auth/register` | 공개 | AuthController.register | frontend/src/service/auth.ts:37 |
| 17 | POST | `/auth/resend-verification` | 공개 | AuthController.resendVerificationEmail | frontend/src/service/auth.ts:51 |
| 18 | GET | `/auth/verify-email` | 공개 | AuthController.verifyEmail | frontend/src/service/auth.ts:43 |
| 19 | DELETE | `/cart` | buyer | CartController.clearCart | frontend/src/service/cart.ts:24 |
| 20 | GET | `/cart` | buyer | CartController.getMyCart | frontend/src/service/cart.ts:4 |
| 21 | POST | `/cart/items` | buyer | CartController.addItem | frontend/src/service/cart.ts:12 |
| 22 | DELETE | `/cart/items/:p` | buyer | CartController.removeItem | frontend/src/service/cart.ts:20 |
| 23 | PATCH | `/cart/items/:p` | buyer | CartController.updateItemQuantity | frontend/src/service/cart.ts:16 |
| 24 | GET | `/categories` | 공개 | CategoryController.getCategoryTree | frontend/src/service/category.ts:13 |
| 25 | GET | `/demo/checkout/options` | 로그인 | DemoCheckoutController.options | frontend/src/service/demo-checkout.ts:18 |
| 26 | GET | `/demo/checkout/orders` | 로그인 | DemoCheckoutController.list | frontend/src/service/demo-checkout.ts:22 |
| 27 | POST | `/demo/checkout/orders` | 로그인 | DemoCheckoutController.create | frontend/src/service/demo-checkout.ts:20 |
| 28 | GET | `/demo/checkout/orders/:p` | 로그인 | DemoCheckoutController.detail | frontend/src/service/order.ts:17 |
| 29 | PATCH | `/demo/checkout/orders/:p/cancel` | 로그인 | DemoCheckoutController.cancel | frontend/src/service/order.ts:22 |
| 30 | POST | `/demo/checkout/orders/:p/reconcile` | 로그인 | DemoCheckoutController.reconcile | frontend/src/service/demo-checkout.ts:25 |
| 31 | POST | `/demo/checkout/verify` | 로그인 | DemoCheckoutController.verify | frontend/src/service/payment.ts:6 |
| 32 | POST | `/inquiries` | buyer · 데모 차단 | InquiryController.create | frontend/src/service/inquiry.ts:42 |
| 33 | DELETE | `/inquiries/:p` | buyer · 데모 차단 | InquiryController.delete | frontend/src/service/inquiry.ts:54 |
| 34 | GET | `/inquiries/my` | buyer | InquiryController.getMyInquiries | frontend/src/service/inquiry.ts:47 |
| 35 | GET | `/inquiries/product/:p` | 로그인 | InquiryController.getByProduct | frontend/src/service/inquiry.ts:34 |
| 36 | GET | `/seller/inquiries` | seller | SellerInquiryController.getMyProductInquiries | frontend/src/service/inquiry.ts:64 |
| 37 | PATCH | `/seller/inquiries/:p/answer` | seller | SellerInquiryController.answer | frontend/src/service/inquiry.ts:71 |
| 38 | POST | `/ops/analyses/:p/review` | admin | OpsController.submitReview | ops-companion/src/lib/api.ts:447 |
| 39 | GET | `/ops/analyses/pending` | admin | OpsController.listPendingReviews | ops-companion/src/lib/api.ts:438 |
| 40 | POST | `/ops/devices` | admin | OpsController.registerDevice | ops-companion/src/lib/api.ts:247 |
| 41 | GET | `/ops/incidents` | admin | OpsController.getIncidents | frontend/src/app/(admin)/admin/ops-app/components/LinkCheckSection.tsx:112 (+1) |
| 42 | GET | `/ops/incidents/:p` | admin | OpsController.getIncident | frontend/src/app/(admin)/admin/ops-app/components/LinkCheckSection.tsx:120 (+1) |
| 43 | POST | `/ops/incidents/:p/analysis` | admin | OpsController.analyzeIncident | ops-companion/src/lib/api.ts:336 |
| 44 | GET | `/ops/release-health` | admin | OpsController.getReleaseHealth | ops-companion/src/lib/api.ts:231 |
| 45 | GET | `/admin/orders` | admin | AdminOrderController.getAllOrders | frontend/src/service/admin-order.ts:22 |
| 46 | GET | `/admin/orders/:p` | admin | AdminOrderController.getOrderDetail | frontend/src/service/admin-order.ts:26 |
| 47 | PATCH | `/admin/orders/:p/deliver` | admin · 데모 차단 | AdminOrderController.markDelivered | frontend/src/service/admin-order.ts:30 |
| 48 | GET | `/orders` | buyer | OrderController.getMyOrders | frontend/src/service/order.ts:13 |
| 49 | POST | `/orders` | buyer · 데모 차단 | OrderController.createOrder | frontend/src/service/order.ts:9 |
| 50 | GET | `/orders/:p` | buyer | OrderController.getOrderDetail | frontend/src/service/order.ts:18 |
| 51 | PATCH | `/orders/:p/cancel` | buyer · 데모 차단 | OrderController.cancelOrder | frontend/src/service/order.ts:23 |
| 52 | PATCH | `/orders/:p/confirm` | buyer | OrderController.confirmOrder | frontend/src/service/order.ts:27 |
| 53 | PATCH | `/orders/:p/test-deliver` | buyer | OrderController.testDeliver | frontend/src/service/order.ts:31 |
| 54 | GET | `/seller/orders` | seller | SellerOrderController.getSellerOrders | frontend/src/service/seller-order.ts:29 |
| 55 | PATCH | `/seller/orders/:p/deliver` | seller | SellerOrderController.deliver | frontend/src/service/seller-order.ts:37 |
| 56 | PATCH | `/seller/orders/:p/ship` | seller | SellerOrderController.markShipped | frontend/src/service/seller-order.ts:33 |
| 57 | POST | `/payments/:p/cancel` | buyer · 데모 차단 | PaymentController.cancelPayment | frontend/src/service/payment.ts:11 |
| 58 | POST | `/payments/verify` | buyer · 데모 차단 | PaymentController.verifyPayment | frontend/src/service/payment.ts:7 |
| 59 | GET | `/admin/products` | admin | AdminProductController.findAll | frontend/src/service/admin-product.ts:32 |
| 60 | PATCH | `/admin/products/:p/approve` | admin · 데모 차단 | AdminProductController.approve | frontend/src/service/admin-product.ts:36 |
| 61 | PATCH | `/admin/products/:p/reject` | admin · 데모 차단 | AdminProductController.reject | frontend/src/service/admin-product.ts:40 |
| 62 | GET | `/products` | 공개 | ProductController.findAll | frontend/src/app/(main)/products/page.tsx:102 |
| 63 | POST | `/products` | seller · 데모 차단 | ProductController.create | frontend/src/service/seller-product.ts:43 |
| 64 | DELETE | `/products/:p` | seller · 데모 차단 | ProductController.remove | frontend/src/service/seller-product.ts:55 |
| 65 | GET | `/products/:p` | 공개 | ProductController.findOne | frontend/src/app/(main)/products/[id]/page.tsx:83 (+1) |
| 66 | PATCH | `/products/:p` | seller · 데모 차단 | ProductController.update | frontend/src/service/seller-product.ts:47 |
| 67 | POST | `/products/:p/images` | seller · 데모 차단 | ProductController.addImage | frontend/src/service/seller-product.ts:61 |
| 68 | GET | `/products/:p/review-summary` | 공개 | ProductController.getReviewSummary | frontend/src/service/review.ts:25 |
| 69 | PATCH | `/products/:p/status` | seller · 데모 차단 | ProductController.updateStatus | frontend/src/service/seller-product.ts:51 |
| 70 | GET | `/products/all` | 공개 | ProductController.findOne | frontend/src/service/products.ts:7 |
| 71 | GET | `/products/my` | seller | ProductController.findMyProducts | frontend/src/service/seller-product.ts:35 |
| 72 | GET | `/products/my/:p` | seller | ProductController.findMyProduct | frontend/src/service/seller-product.ts:39 |
| 73 | POST | `/reviews` | buyer | ReviewController.create | frontend/src/service/review.ts:37 |
| 74 | DELETE | `/reviews/:p` | buyer|admin · 데모 차단 | ReviewController.delete | frontend/src/service/review.ts:47 |
| 75 | PATCH | `/reviews/:p` | buyer · 데모 차단 | ReviewController.update | frontend/src/service/review.ts:42 |
| 76 | GET | `/reviews/my` | buyer | ReviewController.getMyReviews | frontend/src/service/review.ts:32 |
| 77 | GET | `/reviews/product/:p` | 공개 | ReviewController.getByProduct | frontend/src/service/review.ts:15 |
| 78 | GET | `/reviews/product/:p/summary` | 공개 | ReviewController.getProductSummary | frontend/src/service/review.ts:20 |
| 79 | GET | `/seller/applications` | admin | SellerController.getApplications | frontend/src/service/admin-seller.ts:29 |
| 80 | PATCH | `/seller/applications/:p/approve` | admin · 데모 차단 | SellerController.approve | frontend/src/service/admin-seller.ts:33 |
| 81 | PATCH | `/seller/applications/:p/reject` | admin · 데모 차단 | SellerController.reject | frontend/src/service/admin-seller.ts:37 |
| 82 | POST | `/seller/apply` | buyer · 데모 차단 | SellerController.apply | frontend/src/service/seller.ts:14 |
| 83 | GET | `/seller/me` | buyer|seller | SellerController.getMyInfo | frontend/src/service/seller.ts:18 |
| 84 | GET | `/admin/settlements` | admin | AdminSettlementController.getAllSettlements | frontend/src/service/admin-settlement.ts:21 |
| 85 | PATCH | `/admin/settlements/:p/confirm` | admin · 데모 차단 | AdminSettlementController.confirm | frontend/src/service/admin-settlement.ts:25 |
| 86 | PATCH | `/admin/settlements/:p/pay` | admin · 데모 차단 | AdminSettlementController.markAsPaid | frontend/src/service/admin-settlement.ts:29 |
| 87 | GET | `/seller/settlements` | seller | SellerSettlementController.getMySettlements | frontend/src/service/settlement.ts:33 |
| 88 | GET | `/seller/settlements/summary` | seller | SellerSettlementController.getSummary | frontend/src/service/settlement.ts:37 |
| 89 | GET | `/users/me` | 로그인 | UserController.getProfile | frontend/src/service/user.ts:11 |
| 90 | PATCH | `/users/me` | 로그인 · 데모 차단 | UserController.updateProfile | frontend/src/service/user.ts:16 |
| 91 | PATCH | `/users/me/password` | 로그인 · 데모 차단 | UserController.changePassword | frontend/src/service/user.ts:21 |
| 92 | DELETE | `/wishlist` | buyer | WishListController.clearAll | frontend/src/service/wishlist.ts:62 |
| 93 | GET | `/wishlist` | buyer | WishListController.getMyList | frontend/src/service/wishlist.ts:52 |
| 94 | GET | `/wishlist/ids` | buyer | WishListController.getMyProductIds | frontend/src/service/wishlist.ts:57 |
| 95 | POST | `/wishlist/toggle` | buyer | WishListController.toggle | frontend/src/service/wishlist.ts:47 |

## 3. 클라이언트가 부르지 않는 백엔드 라우트 (화면 밖 — 공격자는 알 수 없지만 존재한다)

| 메서드 | 경로 | 가드 | 컨트롤러 |
| --- | --- | --- | --- |
| POST | `/admin/assistant/chat` | admin | AssistantController.chat |
| GET | `/health` | 공개 | AppController.getHealth |
| POST | `/auth/logout-all` | 로그인 | AuthController.logoutAllDevices |
| GET | `/auth/sessions` | 로그인 | AuthController.getActiveSessions |
| DELETE | `/auth/sessions/:tokenId` | 로그인 | AuthController.revokeSession |
| POST | `/admin/categories` | admin · 데모 차단 | AdminCategoryController.create |
| PATCH | `/admin/categories/:id` | admin · 데모 차단 | AdminCategoryController.update |
| DELETE | `/admin/categories/:id` | admin · 데모 차단 | AdminCategoryController.remove |
| PATCH | `/admin/categories/:id/visibility` | admin · 데모 차단 | AdminCategoryController.updateVisibility |
| GET | `/ops/analyses/stats` | admin | OpsController.getReviewStats |
| PUT | `/ops/incidents/:id/note` | admin · 데모 차단 | OpsController.upsertNote |
| POST | `/admin/payments/:orderNumber/cancel` | admin · 데모 차단 | AdminPaymentController.cancelPayment |
| POST | `/payments/webhook` | 공개 | PaymentWebhookController.handleWebhook |

## 4. 클라이언트 요청 타입 ⊆ DTO 대조 (D 선행 점검)

| 클라이언트 타입 | DTO | 프론트만 보내는 키(버려짐/거절) | DTO 필수인데 프론트에 없는 키 | 판정 |
| --- | --- | --- | --- | --- |
| LoginRequest | LoginDto | — | — | OK |
| RegisterRequest | RegisterDto | — | — | OK |
| ApplySellerRequest | ApplySellerDto | — | — | OK |
| CreateProductRequest | CreateProductDto | — | — | OK |
| UpdateProductRequest | UpdateProductDto | — | — | OK |
| UpdateProductStatusRequest | UpdateProductStatusDto | — | — | OK |
| ShipOrderRequest | ShipOrderDto | — | — | OK |
| CreateInquiryRequest | CreateInquiryDto | — | — | OK |
| AnswerInquiryRequest | AnswerInquiryDto | — | — | OK |
| CreateReviewRequest | CreateReviewDto (review) | — | — | OK |
| UpdateReviewRequest | UpdateReviewDto (review) | — | — | OK |
| CreateOrderRequest | CreateOrderDto | — | — | OK |
| VerifyPaymentRequest | VerifyPaymentDto | — | — | OK |
| CancelPaymentRequest | CancelPaymentDto | — | — | OK |
| ToggleWishlistRequest | ToggleWishlistDto | — | — | OK |
| UpdateProfileRequest | UpdateProfileDto | — | — | OK |
| ChangePasswordRequest | ChangePasswordDto | — | — | OK |
| RejectProductRequest | RejectProductDto | — | — | OK |
| RejectSellerRequest | RejectSellerDto | — | — | OK |
| ReviewInput | CreateReviewDto (ops) | — | — | OK |
| cart.addCartItem → AddCartItemDto | AddCartItemDto | — | — | OK |
| cart.updateCartItem → UpdateCartItemDto | UpdateCartItemDto | — | — | OK |
| wishlist.toggleWishlist → ToggleWishlistDto | ToggleWishlistDto | — | — | OK |
| auth.demoLogin → (parseDemoRole, DTO 없음) | — | (DTO 없음: 파이프 미적용) | | INFO |
| auth.resendVerificationEmail → @Body(email) (DTO 없음) | — | (DTO 없음: 파이프 미적용) | | INFO |
| admin-order.deliverOrder → @Body(sellerId) (DTO 없음) | — | (DTO 없음: 파이프 미적용) | | INFO |
| demo-checkout.createDemoCheckout → CreateDemoCheckoutDto | CreateDemoCheckoutDto | — | — | OK |
| ops.registerDevice → RegisterDeviceDto | RegisterDeviceDto | — | — | OK |
| ops.logout → RefreshDto | RefreshDto | — | — | OK |
| admin-assistant.cancel → CancelStreamDto | CancelStreamDto | — | — | OK |

불일치(FAIL/CHECK): 0건
