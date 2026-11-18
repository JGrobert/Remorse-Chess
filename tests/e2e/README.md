# Local browser playtest

This harness starts the real server and Socket.IO transport with a deterministic die sequence and a small legal board fixture. It is for local acceptance play only; it is outside the Docker image and is never enabled by the production server.

## Start

In one terminal:

```sh
npm ci
npm run build
npm run playtest:fixture
```

Open the local URL printed by the harness in two isolated browser sessions. Use White to create an invite, then join it as Black. For each status result, start a fresh room and move White's rook from `a1` to `a7`. The deterministic rolls proceed through `1, 2, 3, 4, 5, 6`; the fixture starts the rook with Psycho and places a second target on `b7`.

## Acceptance checklist

1. Before Black joins, confirm White cannot move. Join from the second session and verify White receives the ready snapshot.
2. After `a1xa7`, leave the roll pending. Reload White while Black stays connected; White must reclaim the same seat and pending capture.
3. On face 1, take the offered `a7xb7` bonus capture. Both sessions must show face 1 and the red Devastated chip; the game passes to Black and the die control is disabled. The bonus itself must not create another roll.
4. In fresh rooms, skip the available bonus after faces 2 through 6. Verify Guilty on 2 and 3, no replacement effect on 4 and 5, and Psycho on 6. Each result must match in both sessions. The fixture's pre-existing Psycho status also exercises a bonus offer after faces 2–6; engine tests separately cover a newly rolled 6 not creating its own same-turn bonus.
5. Retry a roll after a dropped acknowledgement when exercising the room API. The server unit test covers duplicate action IDs and a retry with a new action ID; the stored face must not change. Double-clicking the visible roll button must not trigger a second action.
6. Resign once from each seat in separate rooms and confirm the other session sees the result. Leave both seats in another room, then open its old invite; it must report that the invite is no longer active.
7. Check keyboard selection/highlights and make a move with arrow keys and Enter/Return. Check both board orientations and the responsive layout at a narrow viewport (for example 390 × 844) and a wide viewport.
8. At deployment, check the HTTPS invite flow through Nginx and verify the existing site hostnames still work.
9. For the optional lobby, opt two guests in, challenge and accept between them, then verify they enter one private room. Also exercise decline/cancel, reconnect with the same guest identity, and confirm a third guest never sees that private room in the lobby.

## Playtest report

Local two-browser playtest completed 2026-11-17 against `http://127.0.0.1:8081/` using two isolated sessions and the deterministic fixture.

- The second player joined, and White received a ready snapshot. White could not move before Black joined.
- White reloaded during `awaiting-roll` while Black stayed connected; White reclaimed the seat and the same revision and pending capture. Both sessions then showed the same die face.
- Faces 1–6 were exercised. Face 1 set Devastated and the bonus capture passed play to Black without another roll; faces 2 and 3 set Guilty; faces 4 and 5 left the existing Psycho effect in place; face 6 applied/refreshed Psycho. Both sessions showed the same board and result.
- Both seats resigned in separate rooms. Both seats also left another room; the old invite then showed that the match was no longer active.
- The mobile viewport stacked the room controls, board, die, and status panels. Keyboard navigation selected a piece, moved focus by arrow key, and activated a legal pawn move with Return; the other session received the same move.
- The browser double-click check exposed a control shift: after the first click rolled, the second click could land on the newly displayed Skip button. The UI now keeps a disabled “First roll complete” roll button in its original place and ignores actions while a request is pending. The web unit test checks that state; repeat the browser double-click check after the next build.

The local Nginx/HTTPS gate and checks against the existing site hostnames remain for deployment on the OCI VM, which is not attached to this workspace. Use [the deployment and rollback guide](../../deploy/README.md) for that release gate. Stop the local harness with `Ctrl+C`.
