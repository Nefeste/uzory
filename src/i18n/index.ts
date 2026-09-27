// из votchina: src/i18n/index.ts @ 1242776 (механика, без второго языка)
// Тексты приложения (перенос механики из «Вотчины»). В 1.0 только русский, но все строки —
// через словарь: тест ловит кириллицу вне src/i18n (tools/test/i18n.test.ts).
import { ru } from './ru';

export type Dict = typeof ru;
export const T: Dict = ru;
