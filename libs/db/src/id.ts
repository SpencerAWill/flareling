import { uuidv7 } from "uuidv7";

/**
 * A new primary key: a UUIDv7 (RFC 9562), as text. Its leading bits are a
 * millisecond timestamp, so new rows append to the end of SQLite's B-tree
 * index instead of landing at random pages, and ids sort by creation time.
 * The library keeps ids generated within the same millisecond in order.
 *
 * Primary keys only. A UUIDv7 reveals when it was created, so tokens and
 * anything public that shouldn't leak timing use random values instead.
 * See docs/adr/0011-uuidv7-primary-keys.md.
 */
export function newId(): string {
  return uuidv7();
}

/** Lowercase letters and digits: easy to read aloud and type, URL-safe. */
const PUBLIC_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** 36^10 ≈ 3.7e15 (about 51 bits): collisions are vanishingly rare, and a
 *  unique index catches the rest. */
export const PUBLIC_ID_LENGTH = 10;

/**
 * A short random id for URLs (`/w/k7x2mq9pz4`), in the spirit of nanoid.
 * Random, unlike newId, so it reveals nothing about when its row was made.
 * Not a secret: knowing one grants nothing, since every lookup still checks
 * membership.
 *
 * Bytes at or above the largest multiple of the alphabet's size are
 * rejected, so every character is equally likely.
 */
export function newPublicId(): string {
  const limit = 256 - (256 % PUBLIC_ID_ALPHABET.length);
  let id = "";
  while (id.length < PUBLIC_ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && id.length < PUBLIC_ID_LENGTH) {
        id += PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length];
      }
    }
  }
  return id;
}
