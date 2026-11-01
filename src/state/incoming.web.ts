// Файл, которым открыли игру, — только на Android (incoming.ts): в вебе тайну открывают кнопкой
// «Открыть тайну от друга», а адрес страницы — не файл.
export const isFileUrl = (_url: string | null | undefined): _url is string => false;

export async function readIncoming(_url: string): Promise<Uint8Array> {
  throw new Error('incoming files are Android-only');
}
