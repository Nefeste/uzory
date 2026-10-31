// Звуки вышивания (docs/08-game-design.md, «Звук и музыка»): стежок — мягкий шорох (канва зовёт
// его не чаще 20 раз в секунду), нить закончена — тихий звон, картинка готова. Свои, синтезированы
// кодом (tools/audio/gen.ts, assets/audio/LICENSES.md). Звучат поверх чужой музыки и не
// забирают её, а в беззвучном режиме телефона молчат: игру можно открыть и в транспорте.
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { logError } from './crashlog';

export type SoundName = 'stitch' | 'thread' | 'done';

/**
 * Стежков несколько (tools/audio/gen.ts, STITCHES): вперемешку, не один и тот же два раза подряд, и чуть
 * громче или тише — кисть не звучит одним щелчком (разбор оформления 31.10.2026, 4.1). У каждого — свой
 * проигрыватель: новый стежок не обрывает прежний.
 */
const SOURCES: Record<SoundName, number[]> = {
  stitch: [
    require('../../assets/audio/stitch.wav'),
    require('../../assets/audio/stitch-2.wav'),
    require('../../assets/audio/stitch-3.wav'),
    require('../../assets/audio/stitch-4.wav'),
  ],
  thread: [require('../../assets/audio/thread.wav')],
  done: [require('../../assets/audio/done.wav')],
};

/** Стежок тише всего: он частый и ничего не сообщает. */
const VOLUME: Record<SoundName, number> = { stitch: 0.35, thread: 0.5, done: 0.6 };
/** Громкость стежка гуляет на ±15 %. */
const STITCH_SPREAD = 0.15;

const players: Partial<Record<SoundName, AudioPlayer[]>> = {};
let last = -1;
let moded = false;

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
    const p = player(name);
    p.volume = name === 'stitch' ? VOLUME.stitch * (1 - STITCH_SPREAD + 2 * STITCH_SPREAD * Math.random()) : VOLUME[name];
    p.seekTo(0).catch(() => undefined);
    p.play();
  } catch (e) {
    logError('sound', e, name);
  }
}
