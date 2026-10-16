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
