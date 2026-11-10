// The animation contracts both routes share (docs/ANIMATION_PIPELINE_RFC.md §6):
// the agent-led skill and `launchclip make --animation` write the same files,
// in the same schemas, and check each with the same command.
//
// ANIMATION_CONTRACTS is that table. animationReference() writes the skills'
// references/animation.md from it (scripts/sync-skills.mjs), and
// test/animation_paths.test.js holds the table to the code: every file name
// and schema against the constant its module exports, every command against
// the CLI usage table, and the validator behind each command against the one
// make calls.
//
// A value whose module is on `main` is imported here. One whose module is
// still arriving (the animatic, the retake record, make's stop points) is
// written out, with `source` naming the module and the constant, and the test
// compares the two as soon as the module exists.
import { BIBLE_FILE, BIBLE_SCHEMA, BIBLE_SHEETS } from "@launchclip/core/bible.mjs";
import { SETS } from "@launchclip/core/characters/sets.mjs";
import { DRAWING_STYLES } from "@launchclip/core/characters/styles.mjs";
import { DIRECTION_FILE, DIRECTION_SCHEMA, NARRATIVE_BEATS } from "@launchclip/core/direction.mjs";
import { MAX_SILENCE_SECONDS, NARRATOR, SCREENPLAY_VERSION, SCREENPLAY_WPM } from "@launchclip/core/screenplay.mjs";
import { STORY_SCHEMA } from "@launchclip/core/story.mjs";
import { ANIMATION_PROFILE } from "./make/animation.js";
import { MAX_CRITIC_REPAIRS } from "./make/critic_repair.js";
import { MODEL_ROLES } from "./make/models.js";

export { ANIMATION_PROFILE };
/** The drawing style a new cast gets unless the brief asks for another. */
export const ANIMATION_DRAWING_STYLE = "chibi";
/** The two places a run stops for a person: `make --stop-after <point>` / `--approve <point>`, and the skill's two stops. */
export const APPROVAL_POINTS = Object.freeze(["bible", "animatic"]);
/** The categories a staging review of the animatic may use. */
export const STAGING_REVIEW_CATEGORIES = Object.freeze(["narrative", "composition", "timing", "acting", "character-consistency", "lip-sync"]);
/** The retake steps the skill path uses, cheapest first. */
export const SKILL_RETAKE_STEPS = Object.freeze(["redirect", "replan-beat"]);

const src = (module, names = {}) => Object.freeze({ module, ...names });

/**
 * One row per contract file, in pipeline order.
 *
 * - file, schema: what is on disk (schema null: the file has no schema id).
 * - source: where the code names them: {module, file?, schema?} are export
 *   names in that module.
 * - role: who writes it on the skill path (a MODEL_ROLES key, or null for tooling).
 * - stage: the `make` stage that writes it.
 * - write: the command that writes it, when a command does.
 * - check: the command that validates it, on both routes.
 * - validator: {name, cli, make}: the function behind `check`, the module the
 *   CLI reaches it through and the module make reaches it through.
 */
export const ANIMATION_CONTRACTS = Object.freeze([
  {
    id: "script", file: "SCRIPT.json", schema: SCREENPLAY_VERSION,
    source: src("kit/core/screenplay.mjs", { schema: "SCREENPLAY_VERSION" }),
    role: "writer", stage: "prepare",
    check: { command: "script check", args: "<project> --duration <seconds> --brief <project>/BRIEF.md" },
    validator: { name: "checkScreenplay", cli: "src/script_check_cli.js", make: "src/make/animation.js" }
  },
  {
    id: "bible", file: BIBLE_FILE, schema: BIBLE_SCHEMA,
    source: src("kit/core/bible.mjs", { file: "BIBLE_FILE", schema: "BIBLE_SCHEMA" }),
    role: "designer", stage: "bible",
    write: { command: "bible freeze", args: "<project>" },
    check: { command: "bible show", args: "<project>" },
    validator: { name: "freezeBible", cli: "src/bible.js", make: "src/make/show_bible.js" }
  },
  {
    id: "narration", file: "NARRATION.json", schema: "launchclip.narration.v1",
    source: null,
    role: null, stage: "bible",
    write: { command: "voice", args: "<project>" },
    check: { command: "voice", args: "<project>" },
    validator: null
  },
  {
    id: "direction", file: DIRECTION_FILE, schema: DIRECTION_SCHEMA,
    source: src("kit/core/direction.mjs", { file: "DIRECTION_FILE", schema: "DIRECTION_SCHEMA" }),
    role: "director", stage: "storyboard",
    check: { command: "story validate", args: "<project>/storyboard.json" },
    validator: { name: "validateDirection", cli: "src/story_cli.js", make: "src/storyboard_planner.js" }
  },
  {
    id: "storyboard", file: "storyboard.json", schema: STORY_SCHEMA,
    source: src("kit/core/story.mjs", { schema: "STORY_SCHEMA" }),
    role: "director", stage: "storyboard",
    check: { command: "story validate", args: "<project>/storyboard.json" },
    view: { command: "story shots", args: "<project>" },
    validator: { name: "validateStory", cli: "src/story_cli.js", make: "src/storyboard_planner.js" }
  },
  {
    id: "animatic", file: "ANIMATIC.json", schema: "launchclip.animatic.v1",
    source: src("src/animatic.js", { file: "ANIMATIC_FILE", schema: "ANIMATIC_SCHEMA" }),
    role: null, stage: "animatic",
    write: { command: "finish", args: "<project> --animatic", flags: ["--animatic"] },
    check: { command: "finish", args: "<project> --animatic", flags: ["--animatic"] },
    validator: { name: "writeAnimatic", cli: "src/finish.js", make: "src/finish.js" }
  },
  {
    id: "staging-review", file: "qa/animatic-critic.json", schema: null,
    source: src("src/animatic.js", { file: "ANIMATIC_REVIEW_FILE" }),
    role: "critic", stage: "animatic",
    check: null, validator: null
  },
  {
    id: "critic", file: "qa/critic.json", schema: null,
    source: null,
    role: "critic", stage: "critic",
    check: { command: "cinematic-check", args: "<project> --video renders/draft.mp4 --critique qa/critic.json --expect-audio", skill_only: true },
    validator: null
  },
  {
    id: "retakes", file: "qa/retakes.json", schema: "launchclip.retakes.v1",
    source: src("src/make/critic_repair.js", { file: "RETAKES_FILE", schema: "RETAKES_SCHEMA" }),
    role: "critic", stage: "critic",
    check: null, validator: null
  }
].map((entry) => Object.freeze(entry)));

/**
 * Constants this module writes out because their module may not be on this
 * checkout yet: [our export, module, its export]. The parity test compares
 * each pair when the module exists.
 */
export const MIRRORED_CONSTANTS = Object.freeze([
  ["ANIMATION_DRAWING_STYLE", "src/make/show_bible.js", "DEFAULT_DRAWING_STYLE"],
  ["STAGING_REVIEW_CATEGORIES", "src/make/critic.js", "STAGING_CATEGORIES"]
]);

const contract = (id) => ANIMATION_CONTRACTS.find((entry) => entry.id === id);
const run = (command) => `launchclip ${command.command} ${command.args}`;
const code = (text) => `\`${text}\``;
const list = (values) => values.map(code).join(", ");

function contractTable() {
  const rows = ANIMATION_CONTRACTS.map((entry) => {
    const who = entry.role ? `you, as the ${entry.role}` : "tooling";
    const check = entry.check ? code(run(entry.check)) : "the review that reads it";
    return `| ${code(entry.file)} | ${entry.schema ? code(entry.schema) : "the critic format"} | ${who}${entry.write ? ` (${code(run(entry.write))})` : ""} | ${check} | ${code(entry.stage)} |`;
  });
  return ["| File | Schema | Written by | Checked with | `make` stage |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** references/animation.md for both create-video skills. */
export function animationReference() {
  const script = contract("script"), bible = contract("bible"), narration = contract("narration"), storyboard = contract("storyboard");
  const animatic = contract("animatic"), staging = contract("staging-review"), critic = contract("critic"), retakes = contract("retakes");
  const roles = Object.keys(MODEL_ROLES).filter((role) => ANIMATION_CONTRACTS.some((entry) => entry.role === role));
  if (!DRAWING_STYLES.includes(ANIMATION_DRAWING_STYLE)) throw new Error(`the kit has no "${ANIMATION_DRAWING_STYLE}" drawing style`);
  return `<!-- Generated from src/animation_paths.js by scripts/sync-skills.mjs; edit the code, not this file. -->

# Animation: a character story from one prompt

Use this branch when the brief is a story told by characters: named people who
talk to each other, a scene acted out, "an animated short about…", a skit, a
fable, a two-hander. A narrated explainer in which a character appears for a
beat is not this branch: it is the ordinary quick path with a \`cast-scene\` or
a \`character-cameo\`.

You play four roles in turn (${list(roles)}) and LaunchClip draws
everything in code. Nothing here generates an image or a video, and every
command in this file is local tooling with no model call. Three flags do pay
for a model and are never part of this path unless the user asks for them:
\`finish --review\`, \`finish --retake\` and \`cast create --model\`.

The order is fixed, and two points stop for the user:

1. Model check
2. Script: ${code(script.file)}
3. Show bible: ${code(bible.file)} and the reference sheets. **Stop: the user approves the cast.**
4. Voice: ${code(narration.file)}
5. Shot list: ${code(DIRECTION_FILE)}, then ${code(storyboard.file)}
6. Animatic: ${code(animatic.file)} and your staging review. **Stop: the user approves the animatic.**
7. Draft, critic and retakes: ${code(critic.file)}, ${code(retakes.file)}

## The contract files

\`launchclip make "<prompt>" --animation\` is the same pipeline with an API
model in your seat. Both routes write these files in these schemas and check
each with the same command, so a project started on one route can be finished
on the other. \`make --animation\` delivers 9:16 (a Short) unless you pass
\`--aspect 16:9\` (or \`1:1\`) or the brief names the shape ("a landscape
cartoon", "16:9", "widescreen").

${contractTable()}

Write the files into the output project from the quick path's step 1
(\`.launchclip/agent-<slug>\`), which already holds \`BRIEF.md\`,
\`EVIDENCE.md\` and \`SOURCE.md\`. Default delivery is a 9:16 Short of 20 to 40
seconds with two characters and a narrator.

## 1. Model check

\`\`\`bash
launchclip doctor --models --agent --json
\`\`\`

It reports every role as yours (\`"agent"\`) and makes no paid call. If you
cannot look at images, say so before you start: the cast approval and both
reviews need someone to look, and the user will have to be the one.

## 2. Script (you are the writer)

Three small steps, as the writers' room in \`make\` takes them:

1. **Premise.** One sentence each: what the lead wants, what is in the way,
   what changes.
2. **Loglines.** Write five one-sentence versions of the story. Have them
   judged in a fresh context (a subagent given only the brief and the
   loglines) and take the winner. They are this path's five concepts: the gate at the end
   reads them from \`CONCEPTS.json\` and the story from \`STORY.json\`
   ([cinematic-production.md](cinematic-production.md) has both formats), so
   write those two now.
3. **Script.** Write ${code(script.file)}:

\`\`\`json
{
  "schema_version": "${SCREENPLAY_VERSION}",
  "title": "Test the rollback",
  "logline": "Pia is about to ship on a Friday; Dov asks the one question she skipped.",
  "premise": { "want": "ship before the weekend", "obstacle": "a rollback nobody has tested", "change": "she tests before she ships" },
  "characters": [
    { "id": "pia", "role": "lead", "want": "to ship and go home", "speech": "short, sure of herself" },
    { "id": "dov", "role": "foil", "want": "a quiet weekend for both of them", "speech": "calm, a little dry" }
  ],
  "beats": [
    { "beat": "setup", "place": "desk-laptop", "lines": [
      { "id": "l1", "speaker": "${NARRATOR}", "text": "Pia is about to ship on a Friday." } ] },
    { "beat": "problem", "place": "standing", "lines": [
      { "id": "l2", "speaker": "dov", "text": "Did you test the rollback?", "playing": "light, as if in passing" },
      { "id": "l3", "speaker": "pia", "text": "It worked last month.", "playing": "breezy" },
      { "id": "l4", "speaker": null, "action": "Dov says nothing and waits.", "seconds": 1 } ] }
  ],
  "narration": "Pia is about to ship on a Friday. Did you test the rollback? It worked last month.",
  "title_options": ["Test the rollback", "She almost shipped on a Friday", "It worked last month", "Better now than at midnight", "The ten-minute test"]
}
\`\`\`

- **A narrator with dialogue is the default shape.** The narrator
  (\`"speaker": "${NARRATOR}"\`) sets the scene and lands the ending; the
  characters speak the turns. Write pure dialogue only when the brief asks.
- A line is spoken (\`speaker\` is a character id or \`"${NARRATOR}"\`, with
  \`text\`) or silent (\`"speaker": null\`, with an \`action\` and its
  \`seconds\`). Silent lines are where the acting happens. A silent line, or
  a run of them, is at most ${MAX_SILENCE_SECONDS} seconds, and it goes between two spoken
  lines: one before the first spoken line or after the last is not held.
- \`beats[].beat\` is one of ${list(NARRATIVE_BEATS)}, in story order. There
  must be a \`problem\` beat and it must start early (the check gives the
  limit). \`place\` is a set: ${list(SETS)}.
- \`characters\` are roles, wants and ways of speaking, not looks. Every listed
  character speaks, or is named in a silent line's \`action\`. Ids are
  lowercase (\`^[a-z][a-z0-9-]{0,23}$\`) and become the cast ids.
- \`playing\` is a note for the acting. It is never spoken.
- \`narration\` is every spoken line's text joined in order with spaces.
  \`title_options\` holds five titles, the best first.
- Keep it short: lines of three to nine words, two characters, two sets. At
  the check's pace of ${SCREENPLAY_WPM} words a minute a 30-second Short holds about 60
  spoken words less its pauses.
- Facts, numbers and claims follow the evidence rules: nothing that is not in
  the brief.

Check it, and fix every error before going on:

\`\`\`bash
${run(script.check)}
\`\`\`

Also write \`SCRIPT.md\`, the same lines as a readable screenplay (speaker,
line, the \`playing\` note in brackets), for the user and for the gate at the
end.

## 3. Show bible (you are the designer)

The bible pins who is in the story, what each looks and sounds like, where it
happens and how it is drawn. It is frozen before any shot is planned, and
nothing later may change it.

**Design the cast, and keep it simple.** One character file per script
character, with the script's id, in the ${code(ANIMATION_DRAWING_STYLE)} style unless the
brief names another (the styles: ${list(DRAWING_STYLES)}):

\`\`\`bash
launchclip cast list                      # the starter characters: their ids are taken
launchclip cast options                   # every option the rig can draw
launchclip cast create pia --project <project> --style ${ANIMATION_DRAWING_STYLE} --no-sheet \\
  --describe "a short woman with a dark bob, round glasses and a teal hoodie" --voice af_heart
launchclip cast create dov --project <project> --style ${ANIMATION_DRAWING_STYLE} --no-sheet \\
  --describe "a tall man with short grey hair, a beard and a mustard cardigan" --voice am_michael
\`\`\`

- Three or four traits a viewer would notice are enough: hair, one garment
  and its colour, one accessory. Make the two silhouettes and the two top
  colours different, so they read apart at phone size.
- Give every speaking character a different \`--voice\`, and none of them
  the narrator's (\`launchclip cast options voice\` lists the voices).
- \`cast create\` refuses an id that is a starter's (\`"<id>" is a starter
  character\`). Then either rename the character in ${code(script.file)} and
  run the script check again, or use the starter as it is by naming it in
  \`--characters\` below.
- Read \`assumed\` and \`unmatched\` in the result and fix what matters with
  \`launchclip cast edit <id> --project <project> --set path=value\`.
- Describe traits. Never design a real person's likeness, and read a
  reference image for traits only. The launchclip-character-design skill has
  the full loop when the brief calls for a careful design.

**Freeze it.** Choose the world (\`launchclip bible freeze --help\` lists the
flags), the sets the script's beats use, and a side for each character:

\`\`\`bash
launchclip bible freeze <project> --world office --time day --sets desk-laptop,standing \\
  --position pia=left --position dov=right --rule "Dov never raises his voice."
${run(bible.check)}
\`\`\`

\`bible freeze\` reads the characters saved in the project (or
\`--characters pia,dov\`, which also takes starters), draws one reference
sheet per character to \`${BIBLE_SHEETS}/<id>.png\`, writes \`must_keep\` and
the hash, and pins \`storyboard.json\` and \`DIRECTION.json\` when they exist.
The sheets are drawn in Chromium: if none is found, install one (\`npx
playwright install chromium\`) or name one with \`--chromium <path>\` or
\`LAUNCHCLIP_CHROMIUM\`. \`bible show\` must exit 0: it checks the hash, the
sheets and that every script character has an entry and a voice.

**Look at the sheets** (\`${BIBLE_SHEETS}/<id>.png\`): does each character
match its role, do the two read apart, does every expression read? Change a
character with \`cast edit\`, then freeze again with \`--characters <ids>
--force\`.

**Stop 1: the cast.** Show the user the sheets, the voices and the logline,
and wait for a yes before planning any shot. This is the cheap place to change
a character. After approval the bible does not change: a new look is a new
bible, and every later step is redone against it.

## 4. Voice

Get the dialogue lines from the script, with each silent line turned into the
pause after the line before it:

\`\`\`bash
launchclip script check <project> --json     # → narration.lines
\`\`\`

Write a first \`storyboard.json\` with no scenes yet, and put those lines in
it unchanged:

\`\`\`json
{
  "schema": "${STORY_SCHEMA}",
  "title": "Test the rollback",
  "lane": "motion",
  "format": { "width": 1080, "height": 1920, "fps": 30, "duration": 30, "platform": "youtube-shorts" },
  "world": { "kind": "office", "time": "day" },
  "motion": { "feel": "kinetic" },
  "audio": { "narration": { "provider": "kokoro", "voice": "bf_emma", "lines": [
    { "speaker": "${NARRATOR}", "text": "Pia is about to ship on a Friday." },
    { "speaker": "dov", "text": "Did you test the rollback?" },
    { "speaker": "pia", "text": "It worked last month.", "gap": 1 } ] } },
  "overlays": [{ "type": "captions" }],
  "scenes": []
}
\`\`\`

\`audio.narration.voice\` is the narrator's voice. \`world\` is the bible's
world (its kind and time): the cast then stands in that place, full frame,
and not in a small room of its own. \`motion\` keeps the camera alive under
people who stand and talk. With the seeded style from the quick path's
step 1, name it in \`style\` as [workflow.md](workflow.md) ("No style
given") says, leave \`motion.grammar\` to it, and pass
it to the bible too (\`bible freeze --pack <style>\`). Do not write a
\`cast\`: the bible supplies it.

A story pinned to a bible gets two things without being asked. Its captions
are the character-story treatment whatever the style's caption preset is:
white outlined lines with no band or plate, placed where no character
reaches (above the cast in most 9:16 shots). Write \`{"type": "captions"}\`
and name no preset or position; a preset with a band or a plate fails the
style gate. And every cast scene that arrives and leaves on a cut moves the
camera for as long as it is up: a slow push-in on a speaker, a gentle drift
on a \`wide\` shot, a punch-in on a character who only listens. Plan no
camera for that. A scene's own \`zooms\` replace its move, and
\`"camera": {"moves": false}\` turns them all off.

Pin the story to the bible, then voice it:

\`\`\`bash
launchclip bible freeze <project>     # changes nothing in the bible; writes the story's cast and "bible": {file, hash}
${run(narration.write)}
\`\`\`

\`voice\` speaks each line in its speaker's voice (local Kokoro, free,
cached, at speed 1.2), writes ${code(narration.file)} with a speaker on every word, and prints one
row per line with its start, end and first-word anchor. Set
\`format.duration\` to the measured duration plus 1 to 2 seconds (the closing
card needs the hold), and add
\`"words": "${narration.file}"\` to \`audio\`. If the take is too long, cut lines
in ${code(script.file)} (check it again, copy the new lines across, voice again); never
guess a length from a word count.

## 5. Shot list (you are the director)

There is no shot-list file. A shot is a character scene in
\`storyboard.json\`, and ${code(DIRECTION_FILE)} says why each one exists. Write the map
first, then the storyboard against it. [direction-map.md](direction-map.md)
("Narrative maps") and [storyboard-modules.md](storyboard-modules.md)
(\`cast-scene\`, \`character-cameo\`) hold every field; the rules that matter
here:

**The map.** \`"profile": "${ANIMATION_PROFILE}"\`, one section per story beat, one line
per spoken script line:

\`\`\`json
{
  "schema": "${DIRECTION_SCHEMA}",
  "profile": "${ANIMATION_PROFILE}",
  "sections": [
    { "id": "problem", "title": "Dov asks", "beat": "problem", "set": "standing", "lines": [
      { "words": [7, 11], "line": "l2", "intent": "problem", "treatment": "insert", "scenes": ["ask"], "set": "standing",
        "action": { "verb": "think", "who": "dov" },
        "cast": [{ "id": "dov", "pose": "think", "expression": "happy", "at": "word:Did" }] } ] }
  ]
}
\`\`\`

- \`words\` are inclusive indexes into ${code(narration.file)}'s words; every word belongs
  to exactly one line, in order. \`line\` is the script line the map line
  plays. \`scenes\` names the shot that is up for those words.
- Every line with cast cues names its key \`action\` (\`verb\`, \`who\`), and a
  shot acts it.
- **Whoever speaks is on screen.** While a character says a line, a shot with
  that character in it is up. To stay on the listener instead, give the line a
  \`why\` ("we stay on Pia as it sinks in"). The narrator is never held to
  this.
- A silent script line is played by no map line: act it with a cue in the
  pause it leaves.

**The storyboard.** Add the scenes to the \`storyboard.json\` from step 4:

\`\`\`json
{ "id": "ask", "module": "cast-scene", "start": "word:Did-0.25", "end": "word:Oh.-1",
  "params": { "set": "standing", "shot": "medium", "cast": [
    { "id": "pia", "pose": "stand", "expression": "neutral", "says": "auto",
      "cues": [{ "at": "word:It", "pose": "shrug", "expression": "happy" }] },
    { "id": "dov", "pose": "stand", "expression": "neutral", "says": "auto",
      "cues": [{ "at": "word:Did", "pose": "think", "expression": "happy" }] } ] } }
\`\`\`

- One \`cast-scene\` per shot, on track 0, back to back: a scene ends where the
  next starts, and both are anchored to words (\`word:<text>#1\`,
  \`word:<text>#2\` for a second occurrence, \`±seconds\`). Leave \`in\` out
  between two shots that share a character: a plain cut. A whip-pan or a
  fade there draws the character twice and fails the ghosting gate.
- A cue sits at least 0.45 seconds before its scene ends.
- \`"says": "auto"\` on a character moves its mouth on its own lines. Give it
  to every character who speaks in the shot.
- Cut on a speaker change or a story beat, not on every line: three to six
  shots for 30 seconds. A two-shot (both characters, \`standing\`) carries an
  exchange; a single carries a reaction.
- Frame with \`shot\`, and look at the animatic to see what you got. In 9:16
  the \`standing\` set framed \`close\` puts faces in the top third of the
  frame, which the density gate wants filled for most of the story. A set
  with furniture (a desk, a counter) hides the body and the pose cues behind
  it: use it for one character and one beat, framed \`medium\` or \`close\`
  (\`wide\` there can leave the frame), and play the talk on \`standing\`.
- The story's object (the thing pointed at, the thing that breaks) has to be
  on screen: a \`set-prop\` or a world prop from
  [storyboard-modules.md](storyboard-modules.md), or the closing card.
- Give every shot something to watch. Cue a pose or expression change on the
  key word of each line (from the script's \`playing\` notes) and a reaction
  from the listener on the line that lands on them, so nobody holds one pose
  for more than a second or two. Two people standing still while they talk
  fail the motion gate.
- Use only the bible's characters, sets and world. Do not edit the story's
  \`cast\` or \`bible\`.
- A closing \`character-cameo\` with a card carries a moral or a call to
  action. Keep the card to a kicker and a short title, and let the scene run
  a second or two past the last word: text must stay up long enough to read
  (0.22 seconds a word, the ghosting gate).

Write \`STORYBOARD.md\`, \`DESIGN.md\` and \`QUALITY.md\` as the quick path's
step 4 asks. Check, then read the shot list:

\`\`\`bash
launchclip bible freeze <project>            # pins a newly written ${DIRECTION_FILE}
${run(storyboard.check)}
launchclip layout-check <project>
${run(storyboard.view)}
\`\`\`

\`story validate\` checks the storyboard, the map and the script line ids.
Read its \`status\` (\`passed\`), not its exit code; the same goes for
\`finish\`, which exits 0 on \`needs-repair\`.
In \`story shots\`, look for a speaker marked off screen without a reason, a
shot with nothing said, and script lines listed as unplaced.

## 6. Animatic and staging review (you are the critic)

The animatic is the whole story drawn at draft quality with the real voices
and captions. It locks the timing, and it is the cheap place to fix story,
staging and acting.

\`\`\`bash
${run(animatic.write)} --music synth
\`\`\`

It writes \`renders/animatic.mp4\`, ${code(animatic.file)} (\`${animatic.schema}\`: the
shots, the gates and the hashes of the storyboard and the bible) and contact
sheets in \`qa/critic-sheets/\`. Add the renderer flag the quick path's draft
step uses.

1. **Gates first.** \`gates_failed\` in ${code(animatic.file)} must be empty. A failing
   gate names its fix (\`cast\`, \`bible\`, \`direction\`, \`acting\`,
   \`lip-sync\`, \`layout\`, \`motion\`, \`density\`…). Repair the storyboard,
   never the gate. A gate repair is not a retake: make it, render again, and
   keep \`qa/retakes.json\` for review findings. \`motion\` is the hard one
   for dialogue: it lists each still span in \`qa/finish/motion.json\`; put
   a cue inside each. If it is the only gate still failing after three
   renders, stop, and tell the user at stop 2 that the cut is
   \`needs-repair\` on motion; do not call it finished.
2. **Review from the frames**, in a fresh context where you can: the contact
   sheets beside each character's reference sheet, with the shot list as
   text. Judge story, staging and acting only, in these categories:
   ${list(STAGING_REVIEW_CATEGORIES)}. Does the story land without
   sound? Is the speaker on screen and readable? Does each key action happen
   on its word? Does every character match its sheet in every shot? Does the
   mouth that moves belong to the speaker?
3. Save the review as ${code(staging.file)} in the ${code(critic.file)} format
   ([cinematic-production.md](cinematic-production.md)): a verdict of
   \`ship\`, \`repair\` or \`replan\`, and findings that cite the evidence ids
   they are about. A sheet is what a character must look like, never
   evidence. Then record the verdict in ${code(animatic.file)}:
   \`"review": { "verdict": "ship", "file": "${staging.file}" }\`.
4. **Retake only what fails** (below), until the review says \`ship\` or
   ${MAX_CRITIC_REPAIRS} passes are spent.

**Stop 2: the animatic.** Show the user \`renders/animatic.mp4\` with your
review and any retakes, and wait for a yes before the delivery steps. After
this the timing is locked: later changes restage a shot, they do not re-cut
it.

## 7. Draft, critic and retakes

Go back to the quick path at step 5 and follow it to the end: the
candidates, the draft render (\`launchclip finish <project>\`, which adds
music, sound and the master), a fresh-context critic that writes
${code(critic.file)}, and the gate:

\`\`\`bash
${run(critic.check)}
\`\`\`

The gate reads the quick path's planning files too. The five loglines you
judged are this story's concepts (\`CONCEPTS.json\`) and the script's beats
are its story (\`STORY.json\`): write both in the formats
[cinematic-production.md](cinematic-production.md) gives. The critic of a
character story also puts each reference sheet beside the frames and uses the
\`acting\`, \`character-consistency\` and \`lip-sync\` categories.

**Retakes.** A failed review, of the animatic or of the draft, is fixed one
shot at a time, by the cheapest step that could work:

1. \`${SKILL_RETAKE_STEPS[0]}\`: change the shot a finding names (its poses, expressions,
   cues, set, framing or who is in it) in \`storyboard.json\`. Keep its
   \`start\` and \`end\`, and touch no other scene.
2. \`${SKILL_RETAKE_STEPS[1]}\`: if that shot still fails, or the finding is about the
   story, restage every shot of its story beat the same way.

Render only what changed, then review again:

\`\`\`bash
launchclip finish <project> --animatic --scene <shot id>     # drop --animatic for the draft
\`\`\`

Record every pass in ${code(retakes.file)}:

\`\`\`json
{
  "schema": "${retakes.schema}", "review": "animatic", "limit": ${MAX_CRITIC_REPAIRS},
  "status": "ship", "verdict": "ship",
  "rounds": [{
    "round": 1, "step": "${SKILL_RETAKE_STEPS[0]}",
    "findings": [{ "id": "f1", "severity": "major", "category": "acting", "message": "Pia gives in with no change of pose.", "shots": ["ask"] }],
    "shots": ["ask"], "tried": "Pia puts her hands on her hips as she gives in.",
    "changed": ["ask"], "rendered": ["ask"],
    "verdict_before": "repair", "verdict_after": "ship", "kept": true
  }]
}
\`\`\`

\`review\` is \`animatic\` or \`final\`; \`status\` is \`ship\` or
\`needs-repair\`. A pass that does not lower the blocking and major findings
is undone (put the scenes back as they were) and recorded with \`"kept":
false\`. After ${MAX_CRITIC_REPAIRS} passes that still do not ship, report \`needs-repair\`
and say which shots fail; do not present the video as finished.

## What the user gets

The draft, the two reviews, the retake record, and the contract files above.
Say which stops they approved, which gates passed, and anything still failing.
Render \`--quality high\` only after they approve the draft.
`;
}
