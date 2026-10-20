// из nardy: src/money/rustore.ts @ 63e8ee9 (только оплата: оценки в RuStore у «Узоров» пока нет)
// Тонкая обёртка над нативным модулем RuStore Pay (docs/specs/2026-09-plus.md, «Протокол»).
// Оплата — официальная обёртка RuStore Pay для React Native 11.1.0: её Android-часть приходит
// из maven RuStore и регистрируется плагином plugins/with-rustore.js, а JavaScript-часть
// документация велит перенести в проект. Здесь — только то, что нужно подписке, с теми же
// именами и порядком аргументов, что в примере RuStore (react-native-rustore-pay-sdk-example,
// src/libs/RuStoreReactPay, коммит 58b0909), — как в «Нардах». Правила ответов — ./rustoreRules.ts,
// магазин для экранов — ./rustoreBilling.ts.
import { NativeModules } from 'react-native';

export type RsProductType = 'CONSUMABLE_PRODUCT' | 'NON_CONSUMABLE_PRODUCT' | 'SUBSCRIPTION';

export interface RsProduct {
  productId: string;
  type: RsProductType;
  /** цена строкой, со знаком валюты */
  amountLabel: string;
  price?: number;
  currency: string;
  title: string;
}

export interface RsProductPurchase {
  purchaseId: string;
  productId: string;
  status: string;
  productType: RsProductType;
  acknowledgementState?: string;
  sandbox: boolean;
}

export interface RsSubscriptionPurchase {
  purchaseId: string;
  productId: string;
  status: string;
  /** дата окончания оплаченного периода, ISO 8601 */
  expirationDate: string;
  gracePeriodEnabled: boolean;
  acknowledgementState?: string;
  sandbox: boolean;
}

export interface RsPurchase { productPurchase?: RsProductPurchase; subscriptionPurchase?: RsSubscriptionPurchase }

export interface RsPurchaseResult { purchaseId: string; productId: string; invoiceId: string; productType: RsProductType; sandbox: boolean }

/** Коды ошибок Pay SDK (как в примере RuStore). */
export type RsErrorCode =
  | 'RuStorePaymentNetworkException' | 'RuStorePaymentCommonException' | 'RuStorePayClientAlreadyExist'
  | 'RuStorePayClientNotCreated' | 'RuStorePayInvalidActivePurchase' | 'RuStorePayInvalidConsoleAppId'
  | 'RuStorePaySignatureException' | 'EmptyPaymentTokenException' | 'InvalidCardBindingIdException'
  | 'ApplicationSchemeWasNotProvided' | 'ProductPurchaseException' | 'ProductPurchaseCancelled'
  | 'RuStoreNotInstalledException' | 'RuStoreOutdatedException' | 'RuStoreUserUnauthorizedException'
  | 'RuStoreApplicationBannedException' | 'RuStoreUserBannedException';

export interface PayNative {
  getPurchaseAvailability(): Promise<{ availability: boolean; cause?: string }>;
  getProducts(ids: string[]): Promise<RsProduct[]>;
  getPurchases(productType: string | null, status: string | null, ack: string | null): Promise<RsPurchase[]>;
  getPurchase(purchaseId: string): Promise<RsPurchase>;
  purchase(
    productId: string, orderId: string | null, quantity: number | null, developerPayload: string | null,
    appUserId: string | null, appUserEmail: string | null, preferredPurchaseType: 'ONE_STEP' | 'TWO_STEP' | null,
    sdkTheme: 'LIGHT' | 'DARK' | null, listenerIds: Record<string, string>,
  ): Promise<RsPurchaseResult>;
  updateAcknowledgementState(purchaseId: string, state: 'PENDING' | 'ACKNOWLEDGED' | 'UNKNOWN', payload?: string): Promise<string>;
  getUserAuthorizationStatus(): Promise<boolean>;
  isRuStoreInstalled(): Promise<boolean>;
  openRuStore(): Promise<void>;
  openRuStoreAuthorization(): Promise<void>;
}

/** Оплата RuStore; `null` — модуля в сборке нет (Expo Go, сборка без плагина). */
export const pay: PayNative | null = (NativeModules.RuStoreReactPaySDKModule as PayNative | undefined) ?? null;
