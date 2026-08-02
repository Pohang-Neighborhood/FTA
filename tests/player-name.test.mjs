import assert from "node:assert/strict";
import test from "node:test";
import { compactPlayerName } from "../lib/player-name.js";

test("keeps single-word player names unchanged", () => {
  assert.equal(compactPlayerName("Alisson"), "Alisson");
});

test("uses initials and a recognizable surname for pitch labels", () => {
  assert.equal(compactPlayerName("Jo Hyeon-woo"), "J. Hyeon-woo");
  assert.equal(compactPlayerName("Gabriel Magalhães"), "G. Magalhães");
  assert.equal(compactPlayerName("Virgil van Dijk"), "V. van Dijk");
});

test("normalizes whitespace and rejects missing names", () => {
  assert.equal(compactPlayerName("  Son   Heung-min  "), "S. Heung-min");
  assert.throws(() => compactPlayerName(""), /must not be empty/i);
  assert.throws(() => compactPlayerName(null), /must be strings/i);
});
