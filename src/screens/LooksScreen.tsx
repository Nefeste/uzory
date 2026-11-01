// «Рамки» (решение владельца 31.10.2026, issue 116, вариант Б; docs/08-game-design.md, «Оформления»): рамка — на
// «Готово» и на картинке «Поделиться», макетом. Своя рамка выбирается касанием; чужая — с ценой магазина,
// касание покупает её навсегда (0.18.1, RuStore Pay), «Все оформления» — все сразу. Тёмное дерево — у всех. В
// сборке без магазина (APK из Releases, веб) — строка, где купить. Канва с 0.20.0 — не товар, а часть работы
// (владелец 01.11.2026: «делай канву фоном узора»): она выбирается у работы (src/ui/CanvasPicker.tsx).
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ALL_LOOKS, CANVASES, FRAMES, type FrameId, type FrameLook, isFree, lookOwned, productOf } from '../engine/looks';
import { T } from '../i18n';
import { billing, type BillingFail, type LookPrice } from '../state/billing';
import { ownedLooksNow, refreshLooks, setOwnedLooks, useLooks } from '../state/looks';
import { useSettings } from '../state/settings';
import { clothHex } from '../ui/CanvasPicker';
import { Button, Screen, SectionTitle, Txt } from '../ui/components';

/** Что сказать, если покупка не прошла; отказ игрока — тихо. */
const FAIL: Readonly<Record<Exclude<BillingFail, 'cancelled'>, string>> = {
  'no-store': T.looks.noStore,
  offline: T.looks.offline,
  failed: T.looks.failed,
};

/** Макет рамки на экране, dp. */
const MOCK_W = 96;
const MOCK_H = 72;

function FrameMock({ frame, cloth }: { frame: FrameLook; cloth: string }) {
  if (frame.kind === 'hoop') {
    return (
      <View style={[styles.mockHoop, { backgroundColor: frame.light }]}>
        <View style={[styles.mockHoopCloth, { backgroundColor: cloth }]} />
        <View style={[styles.mockClasp, { borderColor: frame.dark }]} />
      </View>
    );
  }
  return (
    <View style={[styles.mockFrame, { borderTopColor: frame.light, borderLeftColor: frame.light, borderBottomColor: frame.dark, borderRightColor: frame.dark }]}>
      <View style={[styles.mockCloth, { backgroundColor: cloth }, frame.inner ? { borderWidth: 1, borderColor: frame.inner } : null]} />
    </View>
  );
}

export function LooksScreen({ onBack }: { onBack: () => void }) {
  const { update, theme } = useSettings();
  const looks = useLooks();
  const own = (id: FrameId) => lookOwned(id, looks.owned, looks.open);
  const locked = FRAMES.some((f) => !own(f.id));
  /** покупать есть где: сборка запирает, и магазин есть */
  const shop = locked && billing.available;
  const [prices, setPrices] = useState<LookPrice[] | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!shop) return;
    let alive = true;
    void billing.lookPrices().then((p) => {
      if (!alive) return;
      setPrices(p);
      setAsked(true);
    });
    return () => {
      alive = false;
    };
  }, [shop]);

  const priceOf = (product: string) => prices?.find((p) => p.id === product)?.price;

  /** Купить товар; удалась — выбрать купленное (`pick`) и сказать, что оно теперь навсегда. */
  const purchase = async (product: string, done: string, pick?: () => void) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await billing.buyLook(product);
      if (r.ok) {
        setOwnedLooks(r.owned);
        pick?.();
        setNote(done);
      } else if (r.fail !== 'cancelled') setNote(r.detail ? `${FAIL[r.fail]}\n${T.plus.rustoreSaid(r.detail)}` : FAIL[r.fail]);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await refreshLooks();
      setNote(r ? (ownedLooksNow().length ? T.looks.restored : T.looks.nothingToRestore) : T.looks.restoreFailed);
    } finally {
      setBusy(false);
    }
  };

  // подпись под образцом: сейчас, есть, бесплатно или цена магазина
  const state = (id: FrameId, chosen: boolean) => {
    if (chosen) return T.looks.chosen;
    if (isFree(id)) return T.looks.free;
    if (own(id)) return T.looks.owned;
    return busy ? T.looks.buying : T.looks.locked(priceOf(productOf(id)));
  };

  const tile = (id: FrameId, name: string, chosen: boolean, body: ReactNode, onPick: () => void) => (
    <Pressable key={id} onPress={() => (own(id) ? onPick() : shop ? void purchase(productOf(id), T.looks.bought(name), onPick) : undefined)}
      accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: !own(id) && !shop }}
      testID={`look-${id}`}
      style={[styles.tile, { backgroundColor: theme.surface, borderColor: chosen ? theme.accent : theme.border }, chosen && styles.chosen]}>
      {body}
      <Txt bold style={styles.name}>{name}</Txt>
      <Txt dim style={styles.small}>{state(id, chosen)}</Txt>
    </Pressable>
  );

  return (
    <Screen title={T.looks.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body} testID="looks">
        <Txt dim>{T.looks.note}</Txt>
        <SectionTitle>{T.looks.frame}</SectionTitle>
        <View style={styles.grid}>
          {FRAMES.map((f) => tile(f.id, T.looks.frames[f.id], looks.frame.id === f.id,
            <View style={styles.mockBox}><FrameMock frame={f} cloth={clothHex(CANVASES[0])} /></View>,
            () => update({ frame: f.id })))}
        </View>
        {shop ? (
          <View style={styles.shop}>
            <Button label={T.looks.all(priceOf(ALL_LOOKS))} onPress={() => void purchase(ALL_LOOKS, T.looks.boughtAll)} disabled={busy} testID="looks-all" />
            <Button kind="secondary" label={T.looks.restore} onPress={() => void restore()} disabled={busy} testID="looks-restore" />
            {asked && !prices ? <Txt dim style={styles.small} testID="looks-no-price">{T.looks.noPrice}</Txt> : null}
          </View>
        ) : locked ? <Txt dim style={styles.small} testID="looks-soon">{T.looks.soon}</Txt> : null}
        {note ? <Txt style={styles.small} testID="looks-note">{note}</Txt> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  shop: { gap: 8, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 150, borderWidth: 1, borderRadius: 8, padding: 8, gap: 4 },
  chosen: { borderWidth: 2, padding: 7 },
  name: { fontSize: 15 },
  small: { fontSize: 13 },
  mockBox: { height: 84, alignItems: 'center', justifyContent: 'center' },
  mockFrame: { width: MOCK_W, height: MOCK_H, borderWidth: 7, borderRadius: 1 },
  mockCloth: { flex: 1 },
  mockHoop: { width: 80, height: 80, borderRadius: 40, padding: 7, alignItems: 'center', justifyContent: 'center' },
  mockHoopCloth: { width: 66, height: 66, borderRadius: 33 },
  mockClasp: { position: 'absolute', top: -5, left: 32, width: 16, height: 10, borderRadius: 3, borderWidth: 1, backgroundColor: '#c9b98f' },
});
