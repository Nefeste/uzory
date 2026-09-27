// Шрифты студии (SIL OFL 1.1, docs/09-content.md, §11). Каждое начертание — отдельным
// файлом: пакет целиком потянул бы в APK девять файлов Onest вместо трёх.
import { Kurale_400Regular } from '@expo-google-fonts/kurale/400Regular';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { FONTS } from './theme';

export const FONT_FILES = {
  [FONTS.title]: Kurale_400Regular,
  [FONTS.body]: Onest_400Regular,
  [FONTS.medium]: Onest_500Medium,
  [FONTS.bold]: Onest_600SemiBold,
};

/** Шрифт номеров на канве и полосе нитей — файл TTF для Skia. */
export const DIGIT_FONT = Onest_600SemiBold;
