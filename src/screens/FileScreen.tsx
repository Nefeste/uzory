// «Файл работы» (docs/specs/2026-09-spikes.md, П4): большая работа кистью до конца —
// размер файла, запись, разбор и переигрывание; разбор встроенного набора и узор
// по смещению. Числа — для «Что изменилось по ходу работы» спецификации прототипов.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { base64Decode } from '../engine/base64';
import { openPack, packPattern } from '../engine/pack';
import { replay } from '../engine/work';
import { decodeWork, encodeWork } from '../engine/workfile';
import { samplePattern, sampleBrush } from '../engine/sample';
import type { Pattern } from '../engine/pattern';
import { BASE_PACK } from '../content/generated/pack';
import { T } from '../i18n';
import { readFile, writeFile } from '../state/files';
import { WorkSession } from '../state/works';
import { Button, Card, Screen, Txt } from '../ui/components';

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export const BENCH_WORK = 'w-bench-120';

export function FileScreen({ onBack, onReplay }: { onBack: () => void; onReplay: (p: Pattern, workId: string) => void }) {
  const [rows, setRows] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState<Pattern | null>(null);

  const run = async () => {
    setBusy(true);
    const F = T.file;
    const out: [string, string][] = [];
    const p = samplePattern(7, 120, 120, 32);
    const strokes = sampleBrush(p);
    out.push([F.pattern, `${p.w} × ${p.h}, ${T.common.threads(p.threads.length)}`]);
    let t = now();
    const bytes = encodeWork(p.key, Date.now(), strokes);
    out.push([F.encode, F.ms(now() - t)]);
    out.push([F.size, F.kb(bytes.length)]);
    out.push([F.stitches, String(p.w * p.h)]);
    out.push([F.strokes, String(strokes.length)]);
    t = now();
    await writeFile(`${BENCH_WORK}.log`, bytes);
    out.push([F.write, F.ms(now() - t)]);
    t = now();
    const back = await readFile(`${BENCH_WORK}.log`);
    const f = decodeWork(back!);
    const r = replay(p, f.strokes);
    out.push([F.read, F.ms(now() - t)]);
    t = now();
    const raw = base64Decode(BASE_PACK);
    const pack = openPack(raw);
    out.push([F.packParse, F.ms(now() - t)]);
    out.push([F.packSize, `${F.kb(raw.length)} · ${F.pictures(pack.json.pictures.length)}`]);
    const last = pack.json.pictures[pack.json.pictures.length - 1];
    if (last) {
      t = now();
      packPattern(pack, last);
      out.push([F.packOpen, F.ms(now() - t)]);
    }
    // для «Повтора»: работа пишется как настоящая
    const s = new WorkSession(BENCH_WORK, p, f.started, r.strokes, Date.now());
    await s.flush(true);
    setPattern(p);
    setRows(out);
    setBusy(false);
  };

  return (
    <Screen title={T.file.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body}>
        <Button label={busy ? T.file.running : T.file.run} onPress={() => void run()} disabled={busy} testID="file-run" />
        {rows.length ? (
          <Card style={styles.card}>
            {rows.map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Txt dim style={styles.key}>{k}</Txt>
                <Txt bold testID={`file-${k}`}>{v}</Txt>
              </View>
            ))}
          </Card>
        ) : null}
        {pattern ? <Button kind="secondary" label={T.file.replay} onPress={() => onReplay(pattern, BENCH_WORK)} testID="file-replay" /> : null}
        <Txt dim style={styles.note}>{T.file.kill}</Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  card: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  key: { flex: 1 },
  note: { fontSize: 14, lineHeight: 20 },
});
