// Знаки интерфейса (разбор оформления 31.10.2026, 3.3): свои, нарисованы кодом (tools/store/ui-icons.ts),
// белым на прозрачном; цвет темы — через tintColor, так один знак служит и светлой, и тёмной теме.
import { Image, type ImageStyle, type StyleProp } from 'react-native';

const SOURCES = {
  back: require('../../assets/ui/back.png'),
  more: require('../../assets/ui/more.png'),
  search: require('../../assets/ui/search.png'),
} as const;

export type IconName = keyof typeof SOURCES;

export function Icon({ name, color, size = 24, style }: { name: IconName; color: string; size?: number; style?: StyleProp<ImageStyle> }) {
  return <Image source={SOURCES[name]} style={[{ width: size, height: size, tintColor: color }, style]} accessibilityIgnoresInvertColors />;
}
