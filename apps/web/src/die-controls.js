export function getDieControlState({ phase, isCapturer, connected, demoMode, pendingAction }) {
  const awaitingRoll = phase.kind === "awaiting-roll";
  const awaitingBonus = phase.kind === "awaiting-bonus";
  const finished = phase.kind === "finished";
  const canRoll = !demoMode && connected && awaitingRoll && isCapturer;
  const canSkip = !demoMode && connected && awaitingBonus && isCapturer;

  return {
    rollHidden: finished,
    rollDisabled: !canRoll || Boolean(pendingAction),
    rollLabel: pendingAction
      ? "Sending…"
      : awaitingBonus
        ? "First roll complete"
        : canRoll
          ? "Roll for the capture"
          : awaitingRoll
            ? `Waiting for ${phase.player === "white" ? "White" : "Black"} to roll`
            : "Roll for the capture",
    skipHidden: !awaitingBonus,
    skipDisabled: !canSkip || Boolean(pendingAction),
    skipLabel: pendingAction ? "Sending…" : "Skip bonus capture",
  };
}
