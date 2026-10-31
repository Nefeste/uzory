// Фон вышивания (docs/08-game-design.md, «Звук и музыка»; разбор оформления 31.10.2026, 4.8): дождь за
// окном или печь — петлёй, тихо, только на экране вышивания; по желанию игрока, сразу после установки
// выключен. Синтезирован кодом (tools/audio/ambience.ts). Как музыка: входит и уходит плавно, в
// беззвучном режиме телефона молчит, свёрнутая игра не звучит (режим звука — src/state/sound.ts).
import { type AudioPlayer, createAudioPlayer } from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { fadeLevel } from '../engine/music';
import { logError } from './crashlog';
import { audioMode } from './sound';

export type Ambience = 'off' | 'rain' | 'fire';

const SOURCES: Record<Exclude<Ambience, 'off'>, number> = {
  rain: require('../../assets/ambience/rain.webm'),
  fire: require('../../assets/ambience/fire.webm'),
};

/** Тише музыки: фон, а не мелодия. */
export const AMBIENCE_VOLUME = 0.35;
const FADE_IN_MS = 3000;
const FADE_OUT_MS = 800;
const STEP_MS = 100;

let here = false;
let kind: Ambience = 'off';
let player: AudioPlayer | null = null;
let loaded: Exclude<Ambience, 'off'> | null = null;
let level = 0;
let fade: ReturnType<typeof setInterval> | null = null;

function setLevel(v: number) {
  level = v;
  if (player) player.volume = v;
}

function fadeTo(to: number, ms: number, done?: () => void) {
  if (fade) clearInterval(fade);
  const from = level;
  const t0 = Date.now();
  fade = setInterval(() => {
    const t = Date.now() - t0;
    setLevel(fadeLevel(t, ms, from, to));
    if (t >= ms) {
      if (fade) clearInterval(fade);
      fade = null;
      done?.();
    }
  }, STEP_MS);
}

function start() {
  if (!here || kind === 'off') return;
  try {
    audioMode();
    if (!player) {
      player = createAudioPlayer(SOURCES[kind]);
      player.loop = true;
      loaded = kind;
      setLevel(0);
    } else if (loaded !== kind) {
      player.replace(SOURCES[kind]);
      player.loop = true;
      loaded = kind;
    }
    player.play();
    fadeTo(AMBIENCE_VOLUME, FADE_IN_MS);
  } catch (e) {
    logError('sound', e, 'ambience play');
  }
}

function stop() {
  if (!player) return;
  fadeTo(0, FADE_OUT_MS, () => {
    try {
      if (player?.currentStatus.playing) player.pause();
    } catch (e) {
      logError('sound', e, 'ambience pause');
    }
  });
}

/** Экран вышивания открылся: фон — тот, что выбран в настройках. */
export function ambienceEnter(k: Ambience) {
  here = true;
  kind = k;
  start();
}

/** Ушли с экрана вышивания — затихает и встаёт на паузу. */
export function ambienceLeave() {
  here = false;
  stop();
}

/** Выбрали другой фон или выключили его. */
export function ambienceSet(k: Ambience) {
  if (k === kind) return;
  kind = k;
  if (!here) return;
  if (k === 'off') stop();
  else if (loaded && loaded !== k && level > 0) {
    // другой фон: прежний затихает, новый входит
    fadeTo(0, FADE_OUT_MS, start);
  } else start();
}

// в вебе свёрнутая вкладка молчит; на телефоне это делает сам expo-audio
if (Platform.OS === 'web') {
  AppState.addEventListener('change', (st) => {
    if (!player || !here || kind === 'off') return;
    if (st === 'active') start();
    else {
      if (fade) clearInterval(fade);
      fade = null;
      setLevel(0);
      player.pause();
    }
  });
}
