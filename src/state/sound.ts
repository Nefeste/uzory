// Звуки вышивания (docs/08-game-design.md, «Звук и музыка»): стежок — мягкий шорох иглы и нити
// (канва зовёт его не чаще 20 раз в секунду, звучит реже — src/engine/tick.ts), нить закончена — тихий
// звон, картинка готова. Свои, синтезированы кодом (tools/audio/gen.ts, assets/audio/LICENSES.md).
// Звучат поверх чужой музыки и не забирают её, а в беззвучном режиме телефона молчат: игру можно
// открыть и в транспорте.
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { newTicks, stitchTick } from '../engine/tick';
import { logError } from './crashlog';

export type SoundName = 'stitch' | 'thread' | 'done';

/**
 * Стежков шесть (tools/audio/gen.ts, STITCH_PITCH) — один и тот же шорох 0.3.0 на шести высотах, на 3–9 %
 * ниже и выше (владелец 01.11.2026: «нужно было только разнообразить тот стежок»): вперемешку, не один и
 * тот же два раза подряд, и громче или тише — кисть не звучит одним щелчком (разбор оформления
 * 31.10.2026, 4.1). У каждого — свой проигрыватель: новый стежок не обрывает прежний.
 */
const SOURCES: Record<SoundName, number[]> = {
  stitch: [
    require('../../assets/audio/stitch.wav'),
    require('../../assets/audio/stitch-2.wav'),
    require('../../assets/audio/stitch-3.wav'),
    require('../../assets/audio/stitch-4.wav'),
    require('../../assets/audio/stitch-5.wav'),
    require('../../assets/audio/stitch-6.wav'),
  ],
  thread: [require('../../assets/audio/thread.wav')],
  done: [require('../../assets/audio/done.wav')],
};

/** Стежок тише всего: он частый и ничего не сообщает; ритм кисти — src/engine/tick.ts. */
const VOLUME: Record<SoundName, number> = { stitch: 0.35, thread: 0.5, done: 0.6 };

const players: Partial<Record<SoundName, AudioPlayer[]>> = {};
let last = -1;
let moded = false;
const ticks = newTicks();

/** Режим звука игры — один на звуки и музыку (src/state/music.ts): молчать в беззвучном режиме, не забирать чужую музыку, не играть свёрнутой. */
export function audioMode() {
  if (moded) return;
  moded = true;
  if (Platform.OS !== 'web') {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false })
      .catch((e: unknown) => logError('sound', e, 'mode'));
  }
}

function pool(name: SoundName): AudioPlayer[] {
  audioMode();
  let list = players[name];
  if (!list) {
    list = SOURCES[name].map((s) => createAudioPlayer(s));
    players[name] = list;
  }
  return list;
}

function player(name: SoundName): AudioPlayer {
  const list = pool(name);
  if (list.length === 1) return list[0];
  // стежок: любой, кроме прежнего
  let i = Math.floor(Math.random() * (last < 0 ? list.length : list.length - 1));
  if (last >= 0 && i >= last) i++;
  last = i;
  return list[i];
}

/**
 * Проигрыватели — заранее, при входе на экран вышивания: звук грузится не сразу, и созданный на первом
 * стежке проигрыватель мог промолчать (разбор оформления 31.10.2026, Б14).
 */
export function soundsReady() {
  try {
    for (const name of Object.keys(SOURCES) as SoundName[]) pool(name);
  } catch (e) {
    logError('sound', e, 'prepare');
  }
}

/** Сыграть звук; ошибка звука не мешает вышивать — только запись в журнал. */
export function play(name: SoundName) {
  try {
    const k = name === 'stitch' ? stitchTick(ticks, Date.now(), Math.random) : 1;
    if (!k) return;
    const p = player(name);
    p.volume = VOLUME[name] * k;
    p.seekTo(0).catch(() => undefined);
    p.play();
  } catch (e) {
    logError('sound', e, name);
  }
}
