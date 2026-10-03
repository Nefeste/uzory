// Экран «Узоры+» (docs/specs/2026-09-plus.md, «Экран „Узоры+“»; docs/08-game-design.md, «„Узоры+“
// глазами игрока»): что даёт подписка, цены из магазина, до кнопки — всё, что требует закон
// (docs/10-money.md, «Подписка и закон»), «Восстановить покупки», политика. Заранее отмеченных
// галочек нет; «Назад» виден всегда. В сборке 0.x для проверки — образец: цены — гипотезы,
// кнопка неактивна, и переключатель «Как в 1.0», чтобы посмотреть запертые картинки.
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { dailySize } from '../engine/pattern';
import { nextCharge, type PlusPeriod } from '../engine/plus';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { billing, type BillingFail, type Product } from '../state/billing';
import { useCatalog } from '../state/catalog';
import { patternOf } from '../state/library';
import { usePlayer } from '../state/player';
import { usePlus } from '../state/plus';
import { useSettings } from '../state/settings';
import { Button, Screen, ToggleRow, Txt } from '../ui/components';
import { PRIVACY_URL } from './SettingsScreen';

/** Условия подписки на сайте студии — после оферты ИП и сверки с юристом (В10); пока ссылки нет. */
const TERMS_URL: string | null = null;

/**
 * Цены образца — гипотезы из docs/08-game-design.md («„Узоры+“ глазами игрока»), в копейках;
 * в сборке с магазином цены приходят только из RuStore Pay.
 */
const SAMPLE_PRODUCTS: Product[] = [
  { id: 'uzory_plus_month', period: 'month', price: '199 ₽', kopecks: 19900 },
  { id: 'uzory_plus_year', period: 'year', price: '990 ₽', kopecks: 99000 },
];

const FAILS: Record<BillingFail, string | null> = {
  'no-store': T.plus.noStore,
  offline: T.plus.offline,
  failed: T.plus.failed,
  cancelled: null, // отказ игрока — тихо, без уговоров
};

/** «≈ 83 ₽ в месяц» у годовой — если магазин дал цену в рублях. */
const perMonth = (p: Product) => (p.kopecks && p.price.includes('₽') ? T.plus.perMonth(`${Math.round(p.kopecks / 1200)} ₽`) : null);

export function PlusScreen({ onBack, sample }: { onBack: () => void; sample: boolean }) {
  const { theme, settings, update } = useSettings();
  const { today } = usePlayer();
  const plus = usePlus();
  const cat = useCatalog();
  const [products, setProducts] = useState<Product[] | null | undefined>(sample ? SAMPLE_PRODUCTS : undefined);
  const [period, setPeriod] = useState<PlusPeriod>('year');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null);

  // цены — из магазина при каждом открытии; права — тоже спросить заново (spec, «Протокол»)
  useEffect(() => {
    if (sample) return;
    let alive = true;
    void billing.products().then((p) => {
      if (alive) setProducts(p);
    });
    void plus.refresh();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии экрана
  }, [sample]);

  // ряд превью: по одной малой или средней картинке «Узоры+» из разных коллекций
  const previews = useMemo(() => {
    if (!cat) return [];
    const out: { id: string; uri: string | null }[] = [];
    for (const c of cat.collections) {
      const p = c.pictures.find((x) => cat.plusOnly(x) && dailySize(x.size));
      if (p) out.push({ id: p.id, uri: previewUri(patternOf(p), 'done', 160) });
      if (out.length === 4) break;
    }
    return out;
  }, [cat]);

  const chosen = products?.find((p) => p.period === period) ?? null;
  const st = plus.state;
  const open = plus.open;

  const buy = async () => {
    if (!chosen || sample) return;
    setBusy(true);
    setSaid(null);
    const r = await billing.purchase(chosen.id);
    setBusy(false);
    if (r.ok) {
      plus.set(r.state);
      setSaid({ text: T.plus.bought });
    } else if (FAILS[r.fail]) setSaid({ text: FAILS[r.fail]!, bad: true });
  };

  const restore = async () => {
    if (sample || !billing.available) {
      setSaid({ text: sample ? T.plus.sampleRestore : T.plus.noStore, bad: !sample });
      return;
    }
    setBusy(true);
    setSaid(null);
    const open = await plus.refresh();
    setBusy(false);
    if (open === null) setSaid({ text: T.plus.restoreFailed, bad: true });
    else setSaid({ text: open ? T.plus.restored : T.plus.nothingToRestore });
  };

  return (
    <Screen title={T.plus.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body} testID="plus">
        <Txt title style={styles.h}>{T.plus.lead(cat?.pictures.length ?? 0)}</Txt>
        <Txt dim>{T.plus.weekly}</Txt>
        {previews.length ? (
          <View style={styles.row}>
            {previews.map((p) => (
              <View key={p.id} style={[styles.thumb, { backgroundColor: theme.surfaceAlt }]}>
                {p.uri ? <Image source={{ uri: p.uri }} style={styles.thumbImg} resizeMode="contain" /> : null}
              </View>
            ))}
          </View>
        ) : null}

        {open && st ? (
          <View style={[styles.box, { borderColor: theme.border }]} testID="plus-active">
            <Txt bold>{st.until ? T.plus.active(T.plus.date(new Date(st.until).toISOString().slice(0, 10), today.slice(0, 4))) : T.plus.activeNoDate}</Txt>
            {st.status === 'grace' ? <Txt style={{ color: theme.danger }}>{T.plus.grace}</Txt> : null}
            <Txt dim style={styles.small}>{T.plus.manage}</Txt>
          </View>
        ) : (
          <>
            {products === null ? <Txt dim testID="plus-no-price">{T.plus.noPrice}</Txt> : null}
            {products ? (
              <View style={styles.options} accessibilityRole="radiogroup">
                {(['month', 'year'] as const).map((per) => {
                  const p = products.find((x) => x.period === per);
                  if (!p) return null;
                  const on = per === period;
                  const extra = per === 'year' ? perMonth(p) : null;
                  return (
                    <Pressable key={per} onPress={() => setPeriod(per)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                      style={[styles.option, { borderColor: on ? theme.accent : theme.border }]} testID={`plus-${per}`}>
                      <View style={[styles.dot, { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accent : 'transparent' }]} />
                      <Txt style={styles.price}>{per === 'month' ? T.plus.month(p.price) : T.plus.year(p.price)}</Txt>
                      {extra ? <Txt dim style={styles.small}>{extra}</Txt> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {chosen ? (
              <View style={styles.legal} testID="plus-legal">
                <Txt style={styles.small}>{T.plus.renews}</Txt>
                <Txt style={styles.small}>{T.plus.charge(T.plus.date(nextCharge(today, period), today.slice(0, 4)), period === 'year')}</Txt>
                <Txt style={styles.small}>{T.plus.cancelWhere}</Txt>
                <Txt style={styles.small}>{T.plus.keep}</Txt>
              </View>
            ) : null}
            <Button label={sample ? T.plus.sampleBuy : chosen ? T.plus.buy(chosen.price) : T.plus.buy('…')}
              disabled={sample || !chosen || busy} onPress={() => void buy()} style={styles.go} testID="plus-buy" />
          </>
        )}

        {said ? <Txt style={said.bad ? { color: theme.danger } : undefined} testID="plus-said">{said.text}</Txt> : null}

        <View style={styles.links}>
          <Button kind="ghost" small label={T.plus.restore} onPress={() => void restore()} disabled={busy} testID="plus-restore" />
          {TERMS_URL ? <Button kind="ghost" small label={T.plus.terms} onPress={() => void Linking.openURL(TERMS_URL).catch(() => undefined)} /> : null}
          <Button kind="ghost" small label={T.plus.privacy} onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)} testID="plus-privacy" />
        </View>

        {sample ? (
          <View style={[styles.box, { borderColor: theme.border }]} testID="plus-sample">
            <Txt dim style={styles.small}>{T.plus.sample}</Txt>
            <ToggleRow label={T.plus.previewLock} note={T.plus.previewLockNote} value={settings.previewLock}
              onChange={(v) => update({ previewLock: v })} testID="plus-preview-lock" />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 8, paddingBottom: 40 },
  h: { fontSize: 22 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  thumb: { flex: 1, aspectRatio: 1, borderRadius: 6, overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  box: { borderWidth: 1, borderRadius: 6, padding: 12, gap: 6, marginTop: 6 },
  options: { gap: 8, marginTop: 6 },
  option: { borderWidth: 1, borderRadius: 6, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  price: { fontSize: 17 },
  legal: { gap: 4, marginTop: 4 },
  small: { fontSize: 13, lineHeight: 18 },
  go: { marginTop: 8 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
});
