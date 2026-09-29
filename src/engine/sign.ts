// Подпись каталога и хеш наборов (docs/03-server-api.md, «Подпись каталога», «Набор»):
// Ed25519 точных байтов catalog.json, подпись и ключи — base64; SHA-256 — строкой hex. Чистый
// JS (@noble/ed25519, @noble/hashes): одинаково на телефоне (Hermes), в вебе и в сборке.
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { base64Decode, base64Encode } from './base64';

ed.hashes.sha512 = sha512;

export function sha256Hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of sha256(bytes)) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Подпись сходится хотя бы с одним из ключей (нынешний и следующий — для смены ключа). */
export function verifyCatalog(bytes: Uint8Array, sig: string, keys: readonly string[]): boolean {
  let s: Uint8Array;
  try {
    s = base64Decode(sig.trim());
  } catch {
    return false;
  }
  if (s.length !== 64) return false;
  for (const k of keys) {
    try {
      const pub = base64Decode(k);
      if (pub.length === 32 && ed.verify(s, bytes, pub)) return true;
    } catch {
      // битый ключ — следующий
    }
  }
  return false;
}

/** Для сборки каталога в CI (tools/content/catalog.ts): закрытый ключ — только там. */
export function signCatalog(bytes: Uint8Array, secret: string): string {
  return base64Encode(ed.sign(bytes, base64Decode(secret)));
}

export function publicKeyOf(secret: string): string {
  return base64Encode(ed.getPublicKey(base64Decode(secret)));
}

/** Новая пара ключей: закрытый — в секрет CI владельца, открытый — в src/state/keys.ts. */
export function newKeyPair(): { secret: string; public: string } {
  const secret = base64Encode(ed.utils.randomSecretKey());
  return { secret, public: publicKeyOf(secret) };
}
