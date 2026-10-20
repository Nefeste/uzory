// из nardy: plugins/with-rustore.js @ 63e8ee9 (без оценки и сборки `other`; без номера — ничего)
// RuStore Pay в нативной сборке (docs/specs/2026-09-plus.md, «Протокол»): официальная обёртка для
// React Native, `ru.rustore.sdk-wrapper.react-native:pay`, — как в «Нардах».
//
// Папки android/ в репозитории нет (CNG), поэтому всё, что документация RuStore велит вписать
// руками, вписывается здесь:
//   - maven-репозиторий RuStore — в build.gradle проекта;
//   - зависимость оплаты — в build.gradle приложения;
//   - RuStoreReactPayPackage — в MainApplication (обёртка не связывается автоматически);
//   - Intent — в RuStoreReactPayModule из MainActivity при запуске и при возврате по deeplink
//     (после оплаты в приложении банка — СБП, SberPay);
//   - в манифест: console_app_id_value, sdk_pay_scheme_value и схема deeplink у MainActivity.
//
// Номер приложения в консоли RuStore — переменная `EXPO_PUBLIC_RUSTORE_APP_ID` (в CI — из
// переменной репозитория `RUSTORE_APP_ID`, .github/workflows/android.yml). Нет номера — плагин
// ничего не вписывает: сборка та же, что до RuStore Pay (покупок в ней нет — src/state/billing.ts),
// и новых разрешений SDK в ней нет. В «Нардах» SDK встаёт и без номера; здесь сборка без номера —
// сборка для проверки и закрытого теста, и ей SDK оплаты не нужен.
//
// Шаблоны Expo меняются от версии к версии; если вставить не удалось — исключение: молча
// собрать APK без оплаты хуже, чем не собрать.
const { AndroidConfig, withAndroidManifest, withAppBuildGradle, withMainActivity, withMainApplication, withProjectBuildGradle } =
  require('expo/config-plugins');

const PAY = 'ru.rustore.sdk-wrapper.react-native:pay:11.1.0';
const MAVEN = 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed';
/** Схема, по которой приложение банка возвращает игрока после оплаты (только ASCII, RFC 3986). */
const SCHEME = 'gornitsauzorypay';

function fail(what) {
  throw new Error(`with-rustore: шаблон ${what} изменился — RuStore не подключён`);
}

function projectGradle(gradle) {
  if (gradle.includes(MAVEN)) return gradle;
  const all = /allprojects\s*\{\s*repositories\s*\{/;
  if (!all.test(gradle)) fail('android/build.gradle');
  return gradle.replace(all, m => `${m}\n    maven { url = uri("${MAVEN}") }`);
}

function appGradle(gradle) {
  if (gradle.includes(PAY)) return gradle;
  const deps = /\ndependencies\s*\{/;
  if (!deps.test(gradle)) fail('android/app/build.gradle');
  return gradle.replace(deps, m => `${m}\n    implementation("${PAY}")`);
}

function mainApplication(src) {
  if (src.includes('RuStoreReactPayPackage')) return src;
  const list = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!list.test(src)) fail('MainApplication.kt');
  return src
    .replace(/\nimport com\.facebook\.react\.PackageList/, m => `\nimport ru.rustore.react.pay.RuStoreReactPayPackage${m}`)
    .replace(list, m => `${m}\n          add(RuStoreReactPayPackage())`);
}

function mainActivity(src) {
  if (src.includes('RuStoreReactPayModule')) return src;
  const create = /super\.onCreate\(null\)\s*\n\s*\}/;
  if (!create.test(src) || !/\nimport android\.os\.Bundle/.test(src)) fail('MainActivity.kt');
  return src
    .replace(/\nimport android\.os\.Bundle/, m => `\nimport android.content.Intent${m}\nimport ru.rustore.react.pay.RuStoreReactPayModule`)
    .replace(create, `super.onCreate(null)
    // RuStore Pay: запуск по deeplink после оплаты в приложении банка
    if (savedInstanceState == null) intent?.let { RuStoreReactPayModule.processIntent(it) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    RuStoreReactPayModule.processIntent(intent)
  }`);
}

function manifest(m, appId) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(m);
  const meta = (name, value) => AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, value);
  meta('console_app_id_value', appId || '0');
  meta('sdk_pay_scheme_value', SCHEME);
  meta('internal_config_key', 'react-native');
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(m);
  activity['intent-filter'] ??= [];
  const has = activity['intent-filter'].some(f => (f.data ?? []).some(d => d.$['android:scheme'] === SCHEME));
  if (!has) {
    activity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, { $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
      data: [{ $: { 'android:scheme': SCHEME } }],
    });
  }
  return m;
}

module.exports = function withRuStore(config) {
  const appId = (process.env.EXPO_PUBLIC_RUSTORE_APP_ID || '').trim();
  if (!appId) return config;
  config = withProjectBuildGradle(config, c => { c.modResults.contents = projectGradle(c.modResults.contents); return c; });
  config = withAppBuildGradle(config, c => { c.modResults.contents = appGradle(c.modResults.contents); return c; });
  config = withMainApplication(config, c => { c.modResults.contents = mainApplication(c.modResults.contents); return c; });
  config = withMainActivity(config, c => { c.modResults.contents = mainActivity(c.modResults.contents); return c; });
  config = withAndroidManifest(config, c => { c.modResults = manifest(c.modResults, appId); return c; });
  return config;
};
module.exports.SCHEME = SCHEME;
/** Для tools/test/rustore.test.ts: вставки в шаблоны Expo проверяются без сборки. */
module.exports.transforms = { projectGradle, appGradle, mainApplication, mainActivity, manifest };
