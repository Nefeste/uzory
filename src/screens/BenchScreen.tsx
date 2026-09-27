// «Замер» (docs/specs/2026-09-spikes.md, П2; docs/06-testing.md, §4): канва сама двигает
// камеру и водит кистью по 10 или 30 секунд, экран показывает числа кадров. Между замерами
// канвой можно водить руками — числа вживую.
import { useFont } from '@shopify/react-native-skia';
import { Profiler, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, View } from 'react-native';
import { type BenchResult, type BenchScript, type CanvasApi, frameSummary, type LiveStats, type RenderPath, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { samplePattern, sampleStitched } from '../engine/sample';
import { T } from '../i18n';
import { APP_BUILD, APP_VERSION } from '../version';
import { Button, Screen, Segmented, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';

type Size = '150' | '250' | '852';
type Surface = 'texture' | 'surface';
type Length = 'quick' | 'full';

export function BenchScreen({ onBack }: { onBack: () => void }) {
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const [size, setSize] = useState<Size>('150');
  const [path, setPath] = useState<RenderPath>('shader');
  const [surface, setSurface] = useState<Surface>('texture');
  const [mosaic, setMosaic] = useState(false);
  const [length, setLength] = useState<Length>('quick');
  const [script, setScript] = useState<BenchScript | undefined>(undefined);
  const [result, setResult] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const commits = useRef(0);
  const counting = useRef(false);
  const api = useRef<CanvasApi | null>(null);

  // 852 × 556 · 30 — «Утро в сосновом лесу» в четыре клетки на сантиметр холста (139 × 213 см)
  const pattern = useMemo(
    () => (size === '150' ? samplePattern(2, 150, 200, 40) : size === '250' ? samplePattern(4, 250, 250, 45) : samplePattern(6, 852, 556, 30)),
    [size],
  );
  const stitched = useMemo(() => sampleStitched(3, pattern, 0.5), [pattern]);

  const run = () => {
    setResult(null);
    commits.current = 0;
    counting.current = true;
    setScript({ phaseMs: length === 'quick' ? 10000 : 30000, brushRate: 300 });
  };

  const done = (r: BenchResult) => {
    counting.current = false;
    setScript(undefined);
    const B = T.bench;
    const line = (name: string, a: number[]) => {
      const f = frameSummary(a);
      return `${name}: ${f.n} ${B.frames}, ${B.p50} ${f.p50.toFixed(1)}, ${B.p95} ${f.p95.toFixed(1)}, ${B.slow} ${f.slow.toFixed(1)} %, ${B.worst} ${f.worst.toFixed(0)}`;
    };
    const p95 = (a: number[]) => frameSummary(a).p95.toFixed(2);
    setResult([
      `${T.common.appName} ${APP_VERSION} (${APP_BUILD}) · ${Platform.OS} ${String(Platform.Version)}`,
      `${pattern.w} × ${pattern.h}, ${pattern.threads.length} · ${B.paths[path]} · ${B.surfaces[surface]} · ${mosaic ? T.stitch.styles.mosaic : T.stitch.styles.cross}`,
      line(B.phases.pan, r.pan),
      line(B.phases.zoom, r.zoom),
      line(B.phases.brush, r.brush),
      `${B.handler} p95 ${p95(r.handler)} · ${B.texture} p95 ${p95(r.texture)} · build p95 ${p95(r.build)}`,
      `${B.stitches}: ${r.stitches} · ${B.commits}: ${commits.current}`,
    ].join('\n'));
  };

  return (
    <Screen title={T.bench.title} onBack={onBack}>
      <View style={styles.canvas} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} testID="bench-canvas">
        {box && font ? (
          <Profiler id="canvas" onRender={() => { if (counting.current) commits.current++; }}>
            <StitchCanvas
              key={`${size}-${path}-${surface}`}
              pattern={pattern} stitched={stitched} selected={0} mosaic={mosaic} hatch={false}
              bigNumbers={false} fill={false} font={font} width={box.w} height={box.h} apiRef={api}
              path={path} opaque={surface === 'surface'} initial="open"
              script={script} onScriptDone={done} onLive={script ? undefined : setLive}
            />
          </Profiler>
        ) : null}
      </View>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelIn}>
        <Txt dim testID="bench-live">
          {script ? T.bench.running : live ? `${T.bench.phases.live}: ${live.fps} fps, ${T.bench.worst} ${live.worst} ms` : T.bench.manual}
        </Txt>
        {result ? <Txt selectable style={styles.result} testID="bench-result">{result}</Txt> : null}
        <Segmented value={size} onChange={setSize} options={[{ id: '150', label: '150 × 200 · 40' }, { id: '250', label: '250 × 250 · 45' }, { id: '852', label: '852 × 556 · 30' }]} />
        <Segmented value={path} onChange={setPath} testID="bench-path" options={[{ id: 'shader', label: T.bench.paths.shader }, { id: 'layers', label: T.bench.paths.layers }]} />
        {Platform.OS === 'android' ? (
          <Segmented value={surface} onChange={setSurface} options={[{ id: 'texture', label: T.bench.surfaces.texture }, { id: 'surface', label: T.bench.surfaces.surface }]} />
        ) : null}
        <Segmented value={mosaic ? 'mosaic' : 'cross'} onChange={(v) => setMosaic(v === 'mosaic')}
          options={[{ id: 'cross', label: T.stitch.styles.cross }, { id: 'mosaic', label: T.stitch.styles.mosaic }]} />
        <Segmented value={length} onChange={setLength} options={[{ id: 'quick', label: T.bench.lengths.quick }, { id: 'full', label: T.bench.lengths.full }]} />
        <Button label={T.bench.run} onPress={run} disabled={!!script} testID="bench-run" />
        {result ? <Button kind="secondary" label={T.bench.share} onPress={() => void Share.share({ message: result })} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  canvas: { height: '55%', overflow: 'hidden' },
  panel: { flex: 1 },
  panelIn: { padding: 12, gap: 10 },
  result: { fontSize: 13, lineHeight: 19 },
});
