# Day 7: Dino Wait

The idea came from the dead time while Claude Code works on a big task.

## Prompt 1

> when internet is not htere google shows a game. simillar when agency is busy , i want to show a game in terminal which people can play. tell me how is it possible

Claude Code supports mods: plugins that can draw their own panels, take keys and run a frame clock. The plan was a Chrome-style dino runner that opens when Claude starts a task.

## What broke, and what changed

- **Text-character dino.** The first version drew everything with plain characters (`▟▀`, `╬║`, `<v`). It worked, then: "can you make it lok exactl like google broswr game".
- **Pixel art.** Every terminal cell became two stacked pixels (`▀` with a top and a bottom colour), so the T-Rex, cactuses and pterodactyl could be drawn as real sprites.
- **"game play is so bad".** It was laggy, the jump felt wrong and it was unfair. A bot played the game to find out why: it could not clear a single cactus. The dino was large next to the screen, so a jump covered about 1.5 dino-lengths of ground, against roughly 5 in Chrome's. The fix was a higher, longer jump, shorter cactuses and a faster world, then measuring the timing window for every obstacle (about 200 to 430 ms).
- **Lag.** The game redrew hundreds of coloured text pieces every frame. It moved to a pixel grid that is repainted in place, about 30 times a second.
- **Space did nothing, and it was cut off.** Keys only reached the game after a click, and it was sized to the terminal rather than its panel.
- **Colour.** A screenshot of Chrome's game came in with "add colors": blue sky, sun, clouds, an orange T-Rex, green saguaros, a purple pterodactyl, a sandy ground with pebbles.
- **Not in a side panel.** A demo video showed the game inline above the prompt. In fullscreen mode a panel always docks to the side, so the game moved into the band above the prompt, and the keys now come straight from the prompt box: while it is empty, Space, W and S belong to the game; any other key types your next message.

## How it was checked

- `claude plugin test`: tests for showing while Claude works, hiding when it is done, Space starting a run, the high score being saved, messages still typing normally, and the game filling a wide band.
- A bot and a timing-window script run against the real game code.
- Frames rendered to PNG from the game's own code to check the colours and shapes.
