// Музыка (docs/08-game-design.md, «Звук и музыка»): спокойные пьесы по кругу в случайном порядке,
// только на экране вышивания. Начинается с первого стежка, тихо, и нарастает пять секунд: открыть
// игру в транспорте не страшно. Ушли с экрана — затихает и встаёт на паузу; вернулись и сделали
// стежок — пьеса продолжается с того же места. Режим звука — общий со звуками (src/state/sound.ts):
// в беззвучном режиме телефона молчит, чужую музыку не забирает, свёрнутая игра не играет.
// Пьесы и их лицензии — assets/music/music.yaml, список для приложения собирает сборка картинок.
import { type AudioPlayer, type AudioStatus, createAudioPlayer } from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { TRACKS } from '../content/generated/music';
import { fadeLevel, shuffleRound } from '../engine/music';
import { logError } from './crashlog';
import { audioMode } from './sound';

/** Громкость пьесы: файлы выровнены на −20 LUFS — так музыка тише звона нити и готовой картинки. */
export const MUSIC_VOLUME = 0.5;
const FADE_IN_MS = 5000;
const FADE_OUT_MS = 800;
const STEP_MS = 100;

export const hasMusic = TRACKS.length > 0;
/** пьесы с подписями — для «О программе» */
export const musicTracks = TRACKS;

/** настройка «Музыка» */
let enabled = true;
/** экран вышивания открыт */
let here = false;
/** на этом экране уже был стежок: музыка должна звучать */
let live = false;
let player: AudioPlayer | null = null;
let order: number[] = [];
let pos = -1;
let level = 0;
let fade: ReturnType<typeof setInterval> | null = null;
/** когда сменилась пьеса: веб сообщает о конце пьесы не одним событием */
let switched = 0;

const wanted = () => here && live && enabled;

function setLevel(v: number) {
  level = v;
  if (player) player.volume = v;
}

function stopFade() {
  if (fade) clearInterval(fade);
  fade = null;
}

/** Плавно к громкости `to`; `done` — когда дошли. */
function fadeTo(to: number, ms: number, done?: () => void) {
  stopFade();
  const from = level;
  const t0 = Date.now();
  fade = setInterval(() => {
    const t = Date.now() - t0;
    setLevel(fadeLevel(t, ms, from, to));
    if (t >= ms) {
      stopFade();
      done?.();
    }
  }, STEP_MS);
}

/** Пьеса, которая звучит: круг кончился — новый круг, и его первая — не та, что была последней. */
function current(): number {
  if (pos < 0 || pos >= order.length) {
    const last = order.length ? order[order.length - 1] : null;
    order = shuffleRound(TRACKS.length, Math.random, last);
    pos = 0;
  }
  return order[pos];
}

function onStatus(s: AudioStatus) {
  if (s.didJustFinish && Date.now() - switched > 1000) {
    next();
    return;
  }
  // пауза, пока пьеса ещё грузилась, не остановила её: остановим, как только заиграет
  if (s.playing && !wanted() && !fade) player?.pause();
}

function ensure(): AudioPlayer {
  if (player) return player;
  audioMode();
  player = createAudioPlayer(TRACKS[current()].source);
  player.volume = level;
  player.addListener('playbackStatusUpdate', onStatus);
  return player;
}

function next() {
  if (!player) return;
  switched = Date.now();
  pos++;
  try {
    player.replace(TRACKS[current()].source);
    player.volume = level;
    if (wanted()) player.play();
  } catch (e) {
    logError('sound', e, 'music next');
  }
}

function resume() {
  if (!hasMusic) return;
  try {
    ensure().play();
    fadeTo(MUSIC_VOLUME, FADE_IN_MS);
  } catch (e) {
    logError('sound', e, 'music play');
  }
}

function quiet() {
  if (!player) return;
  fadeTo(0, FADE_OUT_MS, () => {
    try {
      // ещё не заиграла — пауза оборвала бы загрузку; остановит onStatus
      if (player?.currentStatus.playing) player.pause();
    } catch (e) {
      logError('sound', e, 'music pause');
    }
  });
}

/** Экран вышивания открылся: музыка ждёт первого стежка. */
export function musicEnter() {
  here = true;
  live = false;
}

/** Ушли с экрана вышивания — затихает и встаёт на паузу. */
export function musicLeave() {
  here = false;
  live = false;
  quiet();
}

/** Стежок: первый на экране начинает музыку. */
export function musicStitch() {
  if (!here || live || !enabled || !hasMusic) return;
  live = true;
  resume();
}

/** Настройка «Музыка»: выключили — затихает; включили — зазвучит с первым стежком. */
export function musicEnabled(on: boolean) {
  enabled = on;
  if (!on && live) {
    live = false;
    quiet();
  }
}

/** Включили в меню канвы — человек на экране вышивания и хочет слышать: начинается сразу. */
export function musicStart() {
  enabled = true;
  if (!here || live || !hasMusic) return;
  live = true;
  resume();
}

// в вебе свёрнутая вкладка молчит; на телефоне это делает сам expo-audio
if (Platform.OS === 'web') {
  AppState.addEventListener('change', (st) => {
    if (!player || !wanted()) return;
    if (st === 'active') resume();
    else {
      stopFade();
      setLevel(0);
      player.pause();
    }
  });
}
