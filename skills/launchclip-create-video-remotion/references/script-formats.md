# Script formats: plan the script before you write it

<!-- Generated from kit/core/script-formats.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

The script decides what kind of video this is. Before writing `SCRIPT.md` (or `audio.narration`), pick a **format**, a **goal** and the viewer's **awareness**, then write the script against the format's skeleton. `launchclip make` does the same with `--format`, `--goal` and `--awareness` (or the defaults below) and records the plan in `SCRIPT.json`.

The skeletons are LaunchClip's own vocabulary: swappable structures from common practice, not proven formulas. The word ceiling is arithmetic and is not optional.

## Steps

1. **Format.** Use the user's words if they name one; otherwise: 5 minutes or more → `long-form`; a verse, quote, fable or tale → `story`; a study, research or data → `data-explainer`; a launch, product or announcement → `promo`; portrait and 90 s or less → `short-form`; "how/why it works" → `explainer`; otherwise `short-form` up to 60 s and `explainer` beyond (a promo when the assets show a product).
2. **Goal.** `convert` when the video should drive an action (sign-ups, trials, sales, bookings, ads; every promo); otherwise `reach`.
3. **Awareness.** How much the viewer already knows (table below). Cold Shorts traffic is usually `problem` or `unaware`; launch announcements `solution` or `product`; retargeting `most`.
4. **Budget.** Target words = duration × the format's words a minute ÷ 60; ceiling = duration × 2.75. Write to the target, measure with `launchclip voice`, never exceed the ceiling.
5. **Write the beats** in the skeleton's order, then record `format`, `goal`, `awareness` and the beat each sentence belongs to in `SCRIPT.md` so the storyboard follows the same beats (one scene group per beat; the hook beat's scene shows the hook's subject at 0 s; the CTA beat gets the end card with the spoken wording).
6. **Titles.** Write three publish-ready title options. For `convert`, put the concrete outcome in the title; no curiosity bait.

## Formats

| Format | Words a minute | Default skeleton | Sentences | Default awareness |
| --- | --- | --- | --- | --- |
| `short-form` | 165 | Call-out hook → problem-agitate-solve | One idea per sentence, 4–10 words each. | `problem` |
| `long-form` | 150 | Long form: pay the title promise by ~30 s, re-engage every ~3 min, soft mid CTA, main CTA at the end | One idea per sentence; keep the mean at about 15 words or fewer and never pass 25. | `problem` |
| `explainer` | 150 | Question → common belief → why it fails → the better model | One idea per sentence; keep the mean at about 15 words or fewer and never pass 25. | `problem` |
| `data-explainer` | 135 | Everyone believes X → a fair test → the result | One idea per sentence; keep the mean at about 15 words or fewer and never pass 25. | `unaware` |
| `story` | 150 (narration over ~75% of the runtime) | Story spine (once upon a time → every day → one day → because of that → until finally) | One idea per sentence; keep the mean at about 15 words or fewer and never pass 25. | `unaware` |
| `promo` | 150 | Launch: news hook + specific claim → features as outcomes → real proof → offer → CTA | One idea per sentence; keep the mean at about 15 words or fewer and never pass 25. | `solution` |

- **`short-form`**: A call-out in the first sentence (≤ 12 words, ideally about 8): it names the topic or the viewer's problem and lands in the first 3 seconds. Above 30 s, add a contrast rehook ("but…") near the middle. Exactly one call to action: one verb, one destination, spoken in the same words the end card shows. It comes after the hook's promise is paid. At 15 s or less, the last line may flow back into the first as a loop instead.
- **`long-form`**: The first one or two sentences share key words with the title; no greeting, channel name or subscribe ask in the first 15 s. The title's promise is confirmed by about 30 s. No call to action in the first 60 s or 15%. One soft mention right after a payoff; the main call to action at the end, one verb and one destination, spoken as the end screen shows it.
- **`explainer`**: The first sentence (≤ 12 words) asks the question the video answers or names the viewer's confusion. Introduce any key term in a short early line before using it. Exactly one call to action: one verb, one destination, spoken in the same words the end card shows. It comes after the hook's promise is paid.
- **`data-explainer`**: The first sentence (≤ 12 words) states the belief the data tests or the question it answers, not the number itself. Exactly one call to action: one verb, one destination, spoken in the same words the end card shows. It comes after the hook's promise is paid. Budgeted slower so each hero number gets a short hold; name the source in the narration or leave it for the on-screen source line.
- **`story`**: The character and what they want in the first line; no brand in it. Adapting a verse, quote or fable: keep the original wording verbatim and split it at clause boundaries. A call to action is optional; if there is one, it is a single line after the ending, never inside the story.
- **`promo`**: Open on the problem or the outcome (≤ 12 words), not the logo; say the product name by about 5 s unless the awareness rule says otherwise. Exactly one call to action: one verb, one destination, spoken in the same words the end card shows. It comes after the hook's promise is paid. For Product Hunt, invite people to try it and give feedback; never ask for upvotes.

## Skeletons

### `call-out-pas`: Call-out hook → problem-agitate-solve

- **Call-out hook** (~10%): Name the viewer or their problem so they think "this is for me": a label, a yes-question, an if-then, a command or a surprising result.
- **Problem** (~20%): State the problem in the viewer's own words, with one concrete detail.
- **Agitate** (~20%): Show what the problem costs them, but only with facts from the brief.
- **Solve** (~30%): Show the answer as an outcome, then pay off the hook's promise.
- **Call to action** (~20%): One action, one destination.

### `before-after-bridge`: Before → after → bridge

- **Hook** (~10%): Open on the viewer's situation or the result they want.
- **Before** (~25%): The world now: the friction, in concrete terms.
- **After** (~25%): The world after: the same scene with the friction gone.
- **Bridge** (~25%): How to get there: the product or idea that connects the two, paying off the hook.
- **Call to action** (~15%): One action, one destination.

### `misconception-first`: Question → common belief → why it fails → the better model

- **Question** (~12%): Ask the question the video answers, or name the viewer's confusion.
- **Common belief** (~18%): Say what most people think, fairly, in one or two lines.
- **Why it fails** (~25%): Show where that belief breaks, with one concrete case.
- **Better model** (~30%): Give the correct picture, one step per sentence.
- **Payoff** (~15%): Answer the opening question in a line; then the call to action, if any.

### `fair-test`: Everyone believes X → a fair test → the result

- **Belief** (~12%): State what everyone believes, or the question the data answers.
- **Fair test** (~25%): Who measured what, how many, and why it is a fair test (source from the brief).
- **Result** (~30%): One hero number per beat, simplified for the ear, each with a perspective ("about 1 in 4", "per person").
- **What it means** (~20%): What changes for the viewer; name a limit of the study if the brief gives one.
- **Close** (~13%): Answer the hook, then one call to action or a takeaway line.

### `story-spine`: Story spine (once upon a time → every day → one day → because of that → until finally)

- **Once upon a time** (~12%): Who the character is and what they want, in the first line.
- **Every day** (~13%): Their routine, and what blocks them.
- **One day** (~15%): The disruption that breaks the routine.
- **Because of that (×n)** (~35%): Cause and effect, each beat caused by the one before; repeat the slot as often as the length allows.
- **Until finally** (~15%): The turn, caused by the character's own choice, not chance.
- **Ever since** (~10%): The new normal, a moral, or the brand arriving late as the guide.

### `launch`: Launch: news hook + specific claim → features as outcomes → real proof → offer → CTA

- **News hook + specific claim** (~15%): What is new and the one concrete thing it does for the viewer.
- **Feature → outcome (2–3)** (~45%): Two or three features, each narrated as the result it gives ("so you can…"); narrate outcomes, not clicks.
- **Proof** (~15%): Real proof only: a demo of the outcome, a fact from the brief, or plain framing ("launching today"). Never an invented customer or number.
- **Offer** (~10%): What they get and on what terms, only as the brief states it.
- **Call to action** (~15%): One action, one destination.

### `long-form`: Long form: pay the title promise by ~30 s, re-engage every ~3 min, soft mid CTA, main CTA at the end

- **Hook** (~3%): The topic or the viewer's problem in the first line, matching the title.
- **Promise** (~4%): Confirm what the title promised by about 30 s: proof you can deliver, the promise and a short plan.
- **Sections** (~60%): Sections that escalate (never front-load the best one); a re-engagement (a reveal, a new stake, a demo result) roughly every 3 minutes.
- **Soft mid CTA** (~3%): One soft mention right after a payoff, never in the first 15%.
- **Payoff** (~22%): The final payoff of the title promise; no "in conclusion" before it lands.
- **Main CTA** (~8%): The main call to action at the end, tied to the end screen.

## Goal

- `reach`: Goal: reach. Win the scroll and the watch time: a sharp call-out, curiosity that carries self-interest (never confusion), a satisfying payoff.
- `convert`: Goal: convert. A concrete outcome beats curiosity bait: say what the viewer gets, prove it with the brief's facts, and make the one action obvious. Fit to the audience matters more than stopping the scroll.

## Awareness and the opening line

- `unaware`: Unaware: open on something the viewer recognises about themselves (identity, a feeling, a surprising observation). No product name, price or pitch in the first sentence.
- `problem`: Problem-aware: name their problem in their own words. No product name or price in the first sentence.
- `solution`: Solution-aware: open on the result they want, then "here's how"; the product can arrive in sentence two or three.
- `product`: Product-aware: open with proof or a comparison with the alternative they know.
- `most`: Most-aware: lead with the offer (and a deadline only if the brief gives a real one); the call to action may come within the first 15% and again at the end.

## Rules for every format

- Hook: the first sentence is 12 words or fewer and names the topic or the viewer's problem. Never open with a greeting, "in this video", "today we're going to" or the brand name (unless the awareness rule puts the offer first).
- Join beats with "but", "so" or "therefore", never "and then": each beat changes what the next one means.
- Close every question you open. The hook's promise is paid off in the final quarter, before the call to action.
- One idea per sentence; keep the mean at about 15 words or fewer and never pass 25. Hard maximum 25 words a sentence.
- Write for the ear: contractions, "you", subject-verb-object order, no parentheses. Spell symbols as spoken ("per cent", not "%").
- Simplify spoken numbers ("4 in 10", not "43.7%") and keep to one number per sentence; the exact figure can go on screen.
- Plain words: about grade 7 or below for consumers and cold audiences, grade 9 or below for business and technical buyers; define any harder word in the same line.
- Exactly one call to action, worded the same when spoken and when shown.
- Never invent facts: every number, name, customer, quote, rating, user count, price, deadline and guarantee must come from the brief, notes, assets or transcripts. No placeholder testimonials, no urgency or scarcity unless the brief gives a real deadline or limit. Illustrative numbers must be framed as examples. When the brief has no proof, use honest substitutes: a demo of the outcome, a plain product fact, "launching today".
