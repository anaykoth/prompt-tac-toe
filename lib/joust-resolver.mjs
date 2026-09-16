import { setResolver } from "./joust.mjs";

/**
 * Where the game's pure pass sim meets the server. games/joust replaces the
 * import below with its own `resolvePass` (the same module its browser
 * previews with) and nothing else changes:
 *
 *   import { resolvePass } from "../games/joust/src/game/pass.js";
 */
import { resolvePass } from "../games/shared/harness/pass-stub.js";

setResolver(resolvePass);
