// Снимок для своего узора на телефоне — в 1.1, вместе с подпиской (docs/specs/2026-09-custom.md,
// «Чего здесь нет»). Пока инструмент есть только в веб-версии: src/state/photo.web.ts.
import type { Raster } from '../engine/build/grid';

export const PHOTO_PICK = false;

export interface Photo {
  raster: Raster;
  uri: string;
  name: string;
  jpeg: Blob;
}

export class PhotoError extends Error {}

export async function pickPhoto(): Promise<Photo | null> {
  return null;
}

export function downloadFiles(_files: { name: string; data: Blob }[]): void {}

export const textBlob = (s: string) => new Blob([s]);
