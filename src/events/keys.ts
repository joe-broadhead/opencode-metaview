// The conversations source's de-dup keys, and the compact set the cursor carries them in.
//
// A key is the top KEY_BITS (25) bits of the 32-bit FNV-1a hash of a conversation's id. The cursor holds the keys of
// the conversations it listed in its lookback as a Golomb-Rice coded set: the keys sorted and de-duplicated, each
// stored as its distance from the one before, that distance's quotient by 2^k in unary (ones, then a zero) and its
// remainder in k bits, with k = floor(log2(2^25 / n)). The first character carries k; the bits follow six to a
// base64url character, the last one padded with ones, which no key can end in. About 19 bits a key: some 200 keys fit
// in the room a 1024-character cursor leaves. A late arrival whose key equals a stored one is taken for it and not
// listed: with 200 keys stored, about 1 in 168,000 late arrivals (200 of 2^25).

/** The bits of a key. */
export const KEY_BITS = 25
const SPACE = 2 ** KEY_BITS
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const VALUE = new Map([...BASE64URL].map((char, index) => [char, index]))

/** A conversation's de-dup key: the top 25 bits of the FNV-1a hash of its id. */
export function seenKey(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193) >>> 0
  return hash >>> (32 - KEY_BITS)
}

/** The keys as the cursor carries them; the empty set is the empty string. */
export function encodeKeys(keys: Iterable<number>): string {
  const sorted = [...new Set(keys)].sort((a, b) => a - b)
  if (sorted.length === 0) return ""
  const k = Math.max(0, Math.min(KEY_BITS, Math.floor(Math.log2(SPACE / sorted.length))))
  const bits: number[] = []
  let previous = 0
  for (const key of sorted) {
    const delta = key - previous
    previous = key
    for (let quotient = Math.floor(delta / 2 ** k); quotient > 0; quotient--) bits.push(1)
    bits.push(0)
    for (let bit = k - 1; bit >= 0; bit--) bits.push(Math.floor(delta / 2 ** bit) % 2)
  }
  while (bits.length % 6 !== 0) bits.push(1)
  let text = BASE64URL[k]!
  for (let at = 0; at < bits.length; at += 6) text += BASE64URL[bits.slice(at, at + 6).reduce((sum, bit) => sum * 2 + bit, 0)]
  return text
}

/** The keys a cursor carries; undefined when the text is not a set this codec wrote. */
export function decodeKeys(text: string): Set<number> | undefined {
  if (text === "") return new Set()
  const k = VALUE.get(text[0]!)
  if (k === undefined || k > KEY_BITS) return undefined
  const bits: number[] = []
  for (const char of text.slice(1)) {
    const value = VALUE.get(char)
    if (value === undefined) return undefined
    for (let bit = 5; bit >= 0; bit--) bits.push((value >> bit) & 1)
  }
  const keys = new Set<number>()
  let previous = 0
  let at = 0
  for (;;) {
    let quotient = 0
    while (at < bits.length && bits[at] === 1) {
      quotient++
      at++
    }
    // Only the padding, at most five ones, ends without a zero.
    if (at >= bits.length) return quotient < 6 && keys.size > 0 ? keys : undefined
    at++
    if (at + k > bits.length) return undefined
    let remainder = 0
    for (let bit = 0; bit < k; bit++) remainder = remainder * 2 + bits[at++]!
    const key = previous + quotient * 2 ** k + remainder
    if (key >= SPACE || (keys.size > 0 && key <= previous)) return undefined
    keys.add(key)
    previous = key
  }
}
