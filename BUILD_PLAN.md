# Remorse Chess: Build Plan

## First Playable Release

Two guests can start a private game from an invite link and play on a classic chessboard. After the first capture of a turn, the player clicks a die beside the board to roll for the capturing piece's modifier. A colored poker chip beneath the piece shows its status. The app runs in one Docker container behind the site's existing Nginx reverse proxy. Add the player lobby after private matches work end to end.

Start with standard piece movement, check, checkmate, stalemate, castling, en passant, and promotion. Keep accounts, chat, rankings, bots, and clocks out of the first playtest. Use unlisted games rather than public matchmaking until the lobby milestone.

## Variant Rules

| d6 | Status | Behavior |
| --- | --- | --- |
| 1 | Devastated | The capturing piece removes itself from the board after three game turns unless rescued by a friendly bishop. |
| 2 or 3 | Guilty | The piece can make ordinary non-capturing moves, but cannot capture for three turns unless rescued. An occupied square still blocks a sliding piece; it cannot capture the blocker or move past it. |
| 4 or 5 | No modifier | No new effect is applied. |
| 6 | Psycho | For three turns, if this piece captures, it may immediately make one more move with that same piece, and the second move must also capture. A roll that gives Psycho also offers that bonus immediately when a legal second capture exists. The bonus capture ends the turn without another roll. |

1. **Duration:** Count the next three completed turns by either side, not the turn that applied the effect. If White's capture leaves a piece Devastated, it comes off after Black, White, then Black finish their turns. This gives White one later turn to move a bishop. Die clicks and Psycho bonus captures do not advance the counter separately.
2. **Bishop rescue:** A friendly bishop must move onto one of the eight neighboring squares (diagonals included). A stationary bishop doesn't count, even if the debuffed piece moves next to it. The bishop's landing clears all adjacent friendly Devastated and Guilty pieces before expiry.
3. **Psycho and status replacement:** Offer a bonus if the capturing piece was already Psycho before the first capture or the first roll gives it Psycho, provided it has a legal second capture; the player may skip it. Reveal the first capture's roll before offering the bonus, but apply it only at settlement so it cannot cancel an earned bonus. Use one status per piece: 1–3 or 6 normally replaces the old status and resets its timer; 4–5 leaves it alone. The bonus capture never rolls, refreshes a status on its own, or grants a third capture.
4. **Kings and check:** A king rolls after its first capture of the turn like any other piece, but only a 6 applies a modifier. Faces 1–5 leave any existing Psycho status and its timer unchanged by the roll. Guilty pieces don't threaten squares for check or castling. Psycho only threatens squares it could capture in one move, not two. Each movement step must leave the mover's king safe, including a Psycho king's bonus capture. If end-of-turn expiry nevertheless exposes the mover's king, the mover loses; if it exposes only the next player's king, that player starts in check.

### Turn Resolution

`Move -> Roll if capture -> Optional Psycho capture or skip -> Settle turn`

- Keep the same player in control until the turn settles. Block further moves during a pending roll. A first capture by en passant or on promotion also triggers a roll. Promotion changes the piece type, not its identity; use the promoted type for any bonus capture. Bonus captures and self-removals do not trigger rolls.
- On each bishop landing, clear eligible statuses already on the board. A pawn promoting to bishop isn't a bishop move. At settlement, apply the one roll outcome if there is one, then expire any statuses still due together and remove Devastated pieces. A newly applied status starts at three full turns remaining. If a timed-out rook is removed, it cannot be used for castling.
- Resolve check and game end only after the full turn, including its rolls and removals. Keep ordinary repetition and no-progress draw rules on the roadmap: compare only settled positions, including side to move, castling/en passant rights, statuses and remaining turns, and count actual captures, pawn moves, and self-removals as progress. For the first playtest, support checkmate, stalemate, resignation, and a bare-kings draw; don't blindly apply classic insufficient-material heuristics to variant positions.

## Architecture

- **Suggested stack:** TypeScript workspace with a pure rules engine, a Node.js server with Socket.IO, and a React/Vite client. Serve the production client and real-time endpoint from the same container and origin.
- **Rules are portable:** Key status by stable piece ID, not square. Keep turn phase, side to move, status expiry, pending capture ID, castling/en passant data, and result in match state. The engine takes explicit actions and roll outcomes so recorded games and tests replay deterministically. Use `chess.js` as a standard-chess test oracle, not as a filter in variant mode: its standard check rules cannot account for Guilty attackers or turn-end removals.
- **Server is authoritative:** Client commands include an action ID and expected revision. Validate the player's seat, active phase, and move; serialize actions per room. A die click requests a roll for the pending first capture; the server generates the face once and returns the same result for a retry. A bonus capture cannot open a roll phase. Send a full versioned snapshot after each accepted action and on reconnect so a dropped event doesn't strand a player.
- **Private matches first:** Use an unguessable invite and separate seat credentials; the invite does not give control of an occupied seat. Keep rooms in memory only. A disconnected player can reclaim their seat and exact game state, including a pending roll, while the other player remains connected. When the server detects that no seated player is connected to the room, discard it and invalidate its invite. A restart or redeploy also clears all games. Validate and rate-limit guest commands before exposing the app publicly.

## Agent Work Packages

Paths below are proposed ownership boundaries. After package 0 defines the shared interfaces, agents can work in separate worktrees and use fixtures or mocks instead of editing one another's packages. Assign the engine packages sequentially or to the same agent; keep one integrator responsible for shared contracts and cross-package changes.

| ID | Owns | Depends on | Deliverable and acceptance check |
| --- | --- | --- | --- |
| 0. Scaffold and contracts | Root config, `packages/protocol/` | None | Set up TypeScript workspaces, scripts and CI; agree on typed commands, snapshots, phase transitions, and the engine interface. Publish sample snapshots for move, roll, bonus, and finished states. |
| 1. Standard chess | `packages/engine/` | 0 | Implement move generation, check/mate/stalemate, castling, en passant and promotion. Compare standard-mode legal moves against `chess.js` on fixed positions with modifiers off. |
| 2. Remorse rules | `packages/engine/` | 1 | Add modifier, bishop, expiry and Psycho mechanics, with injected roll outcomes. Tests cover all six faces, kings receiving only Psycho, blocked Guilty sliders, last-chance rescue, self-removal, and no roll or third capture after a bonus. |
| 3. Guest rooms and sync | `apps/server/` | 0 to start; 2 to integrate | Create/join private rooms, enforce seats and turns, generate rolls, handle resignation, and restore on reconnect while a player stays online. Delete the room when the last player disconnects. Two clients see identical state; stale commands, duplicate clicks and unauthorized seat use do not mutate it. Mock the engine until it lands. |
| 4. Board and die | `apps/web/` | 0 to start; 3 to integrate | Classic responsive board with selectable squares, legal highlights, White/Black orientation, promotion, and roll/skip controls. Either player can leave or end the match by resigning; show a clear message when an invite is no longer active. Use fixtures before networking. Place red (Devastated), amber (Guilty), and purple (Psycho) poker chips below pieces. Add symbols and a text legend with remaining turns so color is not the only cue. The die shows the same result to both players and only the capturer can click it when pending. |
| 5. Docker and Nginx | `Dockerfile`, `compose.yaml`, `.dockerignore`, `deploy/` | 0 to draft; 3 and 4 to smoke-test | Build a multi-stage image with the compiled UI and a non-root server, add a health check, and document the subdomain setup on the existing OCI VM. Verify an invite link and full match through Nginx over HTTPS. No VM access is needed for earlier packages. |
| 6. End-to-end playtest | `tests/e2e/`, `README.md` | 2-5 | Use two isolated browser sessions to complete a private match. Force each status, reload mid-roll while the other player stays online, retry the click, and verify a bonus capture passes play without enabling the die. Verify either seat can resign and the invite stops working once both disconnect. Check mobile layout, keyboard controls, and the existing Nginx sites. Document local start, deploy, and rollback. |
| 7. Player lobby (last) | Lobby features in `apps/web/`, `apps/server/` | 6 | Show online guests who opt into the lobby, allow them to accept or decline challenges, and start a room through the same private match flow. Test presence on reconnect and ensure private rooms are never listed. |

### Test Cases That Should Not Slip

- A bishop already beside a piece does not rescue it; an enemy bishop cannot rescue it. A friendly landing on an eligible square clears the status before settlement.
- A Guilty piece blocks lines as normal but cannot give check. Its expiry can open a check; removing a Devastated blocker can expose either king. Test both cases and final adjudication.
- A freshly rolled 6 can trigger one legal bonus capture in that same turn. A previously Psycho piece can also skip or make exactly one legal second capture, even if its first roll is 1–3. In both cases, the first roll applies at settlement. Verify that the bonus triggers no second roll, no extra countdown tick, and no third capture.
- Roll all six faces for a king: 1–5 do not alter its status or reset its timer; 6 applies or refreshes Psycho. Verify that a Psycho king may take a legal bonus capture but cannot move into check on either step.
- A first capture produces one shared result even if the player double-clicks, retries after a dropped response, reloads, or reconnects. No die action can advance the counter independently.

## Friendly Playtest Session Rules

- **Leave or resign:** Either player can leave without forfeiting or explicitly resign to end the match, even while the other player is in a pending roll. A disconnect alone does not change the board or resolve a pending roll.
- **Reconnect while one stays:** If one player stays connected, the other can rejoin their seat and pick up where play stopped. Once both are offline, the game is gone; opening the old invite shows that the match is no longer active.
- **No timers or persistence:** No chess clock, auto-roll, disconnect forfeit, database, or game recovery after redeploy. Start a fresh invite when a discarded game needs replacing.

## Deployment Plan

- **Use a dedicated subdomain** such as `chess.example.com` on the existing OCI VM. Add a normal “Play Remorse Chess” link from the homepage to the game's HTTPS URL. A subpath avoids the extra DNS record and hostname certificate setup, but adds prefix handling for routes, assets, invites, and Socket.IO. The subdomain keeps the app at `/` and its Nginx config separate from the homepage's routing.
- **Build locally first.** Use same-origin app URLs and test with two local browser sessions. No VM access, DNS record, certificate, or server Docker install is needed to start development.
- **At deployment:** Check the VM's Linux distribution and CPU architecture, install Docker Engine and Compose for that host, and run the app container with its port published only to loopback (for example, `127.0.0.1:8080`). Point the subdomain's DNS record to the VM, add a separate Nginx `server_name` block and HTTPS certificate covering it, and proxy HTTP and WebSocket traffic to the loopback port. Reuse the site's existing public HTTP/HTTPS access; don't open the app port in OCI. Test the Nginx config before reloading it.
- **Release gate:** Confirm the homepage link and existing sites still work. Open a private invite over HTTPS from two different sessions; play a match, refresh one player while the other is online, then verify that both leaving discards the game. Check the health endpoint and retain the previous image tag for rollback. Only then add the lobby.

### Implementation References

- [FIDE base chess rules](https://handbook.fide.com/chapter/e012023) and [chess.js test oracle](https://github.com/jhlywa/chess.js/blob/master/website/docs/index.md)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/) and [Vite's public base path](https://vite.dev/guide/build.html#public-base-path)
- [Docker Engine installation](https://docs.docker.com/engine/install/), [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/), [Nginx server names](https://nginx.org/en/docs/http/server_names.html), and [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
