import assert from "node:assert/strict";
import test from "node:test";
import { getDieControlState } from "../src/die-controls.js";

test("the roll button stays disabled in its place while Psycho bonus controls appear", () => {
  const controls = getDieControlState({
    phase: { kind: "awaiting-bonus", player: "white" },
    isCapturer: true,
    connected: true,
    demoMode: false,
    pendingAction: null,
  });

  assert.equal(controls.rollHidden, false);
  assert.equal(controls.rollDisabled, true);
  assert.equal(controls.rollLabel, "First roll complete");
  assert.equal(controls.skipHidden, false);
  assert.equal(controls.skipDisabled, false);
});

test("pending roll requests disable both controls until the server responds", () => {
  const controls = getDieControlState({
    phase: { kind: "awaiting-roll", player: "black" },
    isCapturer: true,
    connected: true,
    demoMode: false,
    pendingAction: { actionId: "roll-action" },
  });

  assert.equal(controls.rollDisabled, true);
  assert.equal(controls.rollLabel, "Sending…");
});
