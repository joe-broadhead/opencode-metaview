// The cursor's de-dup keys: the Golomb-Rice coded set's round trip and refusals, how many keys fit the room a full
// cursor leaves, and the measured rate at which a late arrival is taken for a listed conversation.
import { describe, expect, test } from "bun:test"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { EVENT_LIMITS } from "@we-the-rebel-alliance/source-contract/events"
import { KEY_BITS, decodeKeys, encodeKeys, seenKey } from "../../src/events/keys.js"

/** A deterministic stream of keys, as ids hashed. */
const keysOf = (count: number, base = 41_000_000, step = 37) => Array.from({ length: count }, (_, index) => seenKey(String(base + index * step)))

describe("the coded set", () => {
  test("round-trips any set, sorted and de-duplicated, from empty to large", () => {
    expect(encodeKeys([])).toBe("")
    expect(decodeKeys("")).toEqual(new Set())
    for (const count of [1, 2, 3, 7, 50, 199, 200, 500, 2_000]) {
      const keys = keysOf(count, 41_000_000 + count)
      expect(decodeKeys(encodeKeys(keys))).toEqual(new Set(keys))
    }
    // The extremes: key 0, the largest key, neighbours, and a repeat.
    const edges = [0, 1, 2, 2 ** KEY_BITS - 1, 2 ** KEY_BITS - 2, 12_345, 12_345]
    expect(decodeKeys(encodeKeys(edges))).toEqual(new Set(edges))
    expect(encodeKeys(keysOf(100))).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test("refuses text it did not write", () => {
    for (const text of ["!", "Z", "AA", "A////", "a" + "_".repeat(10), "k@@@"]) expect(decodeKeys(text)).toBeUndefined()
  })

  test("costs about 19 bits a key, so about 200 keys fit the room a full cursor leaves", () => {
    const binding = { plugin: "metaview", source: "metaview", account: "4100/77" }
    // The largest state the cursor carries besides the keys: 13-digit times, an 8-digit id, a gap line and the flag.
    const fits = (keys: string) => {
      try {
        return encodeBoundCursor(binding, { a: "4100/77", t: 1793739600000, i: "41000037", l: 1793108064000, n: keys, g: 1791000000000, r: 1 }).length <= EVENT_LIMITS.cursor
      } catch {
        return false
      }
    }
    let capacity = 0
    while (fits(encodeKeys(keysOf(capacity + 1)))) capacity++
    expect(capacity).toBeGreaterThanOrEqual(190)
    expect(capacity).toBeLessThanOrEqual(230)
    const bitsPerKey = ((encodeKeys(keysOf(200)).length - 1) * 6) / 200
    expect(bitsPerKey).toBeGreaterThan(17)
    expect(bitsPerKey).toBeLessThan(21)
  })

  test("takes about 1 late arrival in 168,000 for a listed one with 200 keys stored: measured", () => {
    const stored = new Set(keysOf(200))
    let hits = 0
    const tries = 2_000_000
    for (let index = 0; index < tries; index++) if (stored.has(seenKey(String(50_000_000 + index)))) hits++
    // 200 of 2^25 is 1 in 167,772: about 12 of 2,000,000; well under the old 18-bit keys' 1 in 1,300.
    expect(hits).toBeLessThan(40)
    expect(tries / Math.max(1, hits)).toBeGreaterThan(50_000)
  })
})
