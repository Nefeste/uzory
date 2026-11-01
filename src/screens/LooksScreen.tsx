// «Рамки и стены» (решение владельца 31.10.2026, issue 116, вариант Б; docs/08-game-design.md, «Оформления»):
// рамка и (с 0.21.0) стена — на «Готово» и на картинке «Поделиться»; паспарту — у любой рамы, бесплатно.
// Образцы — той же сценой, что «Готово» (src/render/scene.ts). Своё выбирается касанием; чужое — с ценой
// магазина, касание покупает его навсегда (0.18.1, RuStore Pay), «Все оформления» — все сразу. Тёмное дерево и
// светлый фон без стены — у всех. В сборке без магазина (APK из Releases, веб) — строка, где купить. Канва с
// 0.20.0 — не товар, а часть работы: она выбирается у работы (src/ui/CanvasPicker.tsx).
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ALL_LOOKS, FRAMES, isFree, type LookId, lookOwned, productOf, WALLS } from '../engine/looks';
import { T } from '../i18n';
import { lookSample } from '../render/scene';
import { billing, type BillingFail, type LookPrice } from '../state/billing';
import { ownedLooksNow, refreshLooks, setOwnedLooks, useLooks } from '../state/looks';
import { useSettings } from '../state/settings';
import { Button, Screen, SectionTitle, Segmented, Txt } from '../ui/components';

/** Что сказать, если покупка не прошла; отказ игрока — тихо. */
const FAIL: Readonly<Record<Exclude<BillingFail, 'cancelled'>, string>> = {
  'no-store': T.looks.noStore,
  offline: T.looks.offline,
  failed: T.looks.failed,
};

export function LooksScreen({ onBack }: { onBack: () => void }) {
  const { update, theme } = useSettings();
  const looks = useLooks();
  const own = (id: LookId) => lookOwned(id, looks.owned, looks.open);
  const locked = FRAMES.some((f) => !own(f.id)) || WALLS.some((w) => !own(w.id));
  // образцы — рама на нынешней стене, стена с нынешней рамой; паспарту — как выбрано
  const frameSamples = useMemo(() => new Map(FRAMES.map((f) => [f.id, lookSample(f, looks.wall, looks.mat)])), [looks.wall, looks.mat]);
  const wallSamples = useMemo(() => new Map(WALLS.map((w) => [w.id, lookSample(looks.frame, w, looks.mat)])), [looks.frame, looks.mat]);
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
  const state = (id: LookId, chosen: boolean) => {
    if (chosen) return T.looks.chosen;
    if (isFree(id)) return T.looks.free;
    if (own(id)) return T.looks.owned;
    return busy ? T.looks.buying : T.looks.locked(priceOf(productOf(id)));
  };

  const tile = (id: LookId, name: string, chosen: boolean, body: ReactNode, onPick: () => void, prefix = 'look') => (
    <Pressable key={id} onPress={() => (own(id) ? onPick() : shop ? void purchase(productOf(id), T.looks.bought(name), onPick) : undefined)}
      accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: !own(id) && !shop }}
      testID={`${prefix}-${id}`}
      style={[styles.tile, { backgroundColor: theme.surface, borderColor: chosen ? theme.accent : theme.border }, chosen && styles.chosen]}>
      {body}
      <Txt bold style={styles.name}>{name}</Txt>
      <Txt dim style={styles.small}>{state(id, chosen)}</Txt>
    </Pressable>
  );

  const sample = (uri: string | null | undefined) => (uri
    ? <Image source={{ uri }} style={styles.sample} resizeMode="cover" />
    : <View style={[styles.sample, { backgroundColor: theme.surfaceAlt }]} />);

  return (
    <Screen title={T.looks.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body} testID="looks">
        <Txt dim>{T.looks.note}</Txt>
        <SectionTitle>{T.looks.frame}</SectionTitle>
        <View style={styles.grid}>
          {FRAMES.map((f) => tile(f.id, T.looks.frames[f.id], looks.frame.id === f.id, sample(frameSamples.get(f.id)), () => update({ frame: f.id })))}
        </View>
        <SectionTitle>{T.looks.mat}</SectionTitle>
        <Segmented<'on' | 'off'> value={looks.mat ? 'on' : 'off'} onChange={(v) => update({ mat: v === 'on' })} testID="looks-mat"
          options={[{ id: 'on', label: T.looks.matLevels.on }, { id: 'off', label: T.looks.matLevels.off }]} />
        <Txt dim style={styles.small}>{T.looks.matNote}</Txt>
        <SectionTitle>{T.looks.wall}</SectionTitle>
        <View style={styles.grid}>
          {WALLS.map((w) => tile(w.id, T.looks.walls[w.id], looks.wall.id === w.id, sample(wallSamples.get(w.id)), () => update({ wall: w.id }), 'wall'))}
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
  sample: { width: '100%', aspectRatio: 3 / 2, borderRadius: 4 },
});
