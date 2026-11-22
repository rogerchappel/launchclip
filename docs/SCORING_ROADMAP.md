# Scoring roadmap

Status: every stage has a first version for a hosted model, under [`launchclip score`](guide/scoring.md). Not built: reading the video itself (stage 8), the test for when a rubric is done (stage 9), formats across industries (stage 10), the local model, scoring a draft from a preview render, and a per-post bandit (stage 6 moves shortlist slots between hook types). A rubric can be drafted from a library found by keyword (`score library discover`, `score rubric draft`). Keyword discovery and the rubric drafter have had one small real run on TikTok (5 creators, 93 posts: too few to keep a gate). Not yet tried on real data: Instagram discovery, a library large enough to keep a gate, and the fitted layer on real posts. Background and sources: [research report](../reports/JEV%20scoring%20model%20for%20content.md).

## The idea

A new kind of model answers closed questions instead of writing text. You send it some content and a list of questions (yes/no, pick one, rate on a scale) and it returns an answer and a confidence for each, in a fraction of a second, for cents per thousand items. Two hosted ones exist today: Jev (text and still images) and Gemini Decision 1 (text, images, audio, video and PDFs). Small open models can do the same job locally, less accurately.

That makes it cheap to ask twenty checkable questions about every hook, script line, source, slide and competitor video. LaunchClip can use this in three places: research, generating and filtering many options, and learning what works for one brand.

## What a scorer can and can't do

- **Can:** check content against written criteria ("names the audience", "opens on the payoff", "states a number"), tag content by type, and sort research by relevance. Independent tests put it level with a large model on this kind of check.
- **Can't:** tell you whether a hook is good when asked cold. Every model tested was at chance on that, and no source links these scores to views, retention or clicks.
- **So:** the scorer supplies checks and tags. Real results decide what works.

## Stages

Each stage is useful without the ones after it.

### 0. Measure first

Hand-label 200 hooks and script lines against ten closed criteria. Run a local open model and one hosted model over them. Continue only if agreement with the labels is high enough to gate on, and record which backend clears the bar.

### 1. One scorer, several backends

- One call: content plus named questions in, typed answers with confidence out.
- Local backend by default (a small open model on Apple Silicon), so the feature works with no key.
- Hosted backends as optional upgrades with your own key, direct or through OpenRouter. A closed model is never bundled.
- A **rubric file** per brand: the brand's taste written as closed questions. This file, and the tags and results collected against it, is the lasting asset. The model behind it is replaceable.

### 2. Rubric gate

Run the brand's rubric on every hook, script and carousel slide before any render. Failures are flagged or repaired, the same way the existing checks work. Low-confidence answers go to the larger model or to you.

### 3. Competitor video library (research)

- Collecting the library: a scraping service such as Apify can search TikTok and Instagram by keyword, hashtag or account and return each video with its caption and public numbers (views, likes, comments, shares, posting date). It is an optional source with your own key. A folder of files with a spreadsheet of numbers works too.
- You point LaunchClip at a set of videos from your niche. It reads each one with a video-capable scorer and tags it: hook type, what the first frame shows, pacing, format, angle, call to action, and around fifty more.
- It joins the tags to each video's public numbers, measured against that channel's own typical video, so a small channel's hit counts as a hit.
- The output is a map of the niche: which hook types and angles are crowded, which are open, and which beat their channel's norm.
- The library must include ordinary and weak videos from the same channels, not only the hits, or the patterns mean nothing.
- Fetching the videos is yours to do and must respect each platform's terms. LaunchClip reads files or links you give it.

### 4. Generate wide, keep it varied

- Write hundreds or thousands of hooks and angles per topic.
- Writing is the slow step, and a scorer can't write. Two ways to keep it quick: a small, fast writing model producing batches in parallel, with the larger model saved for the shortlist; and **assembly**, where hooks are built from parts (opening pattern, angle, audience, number, payoff) taken from the competitor library and the brand's research, and the scorer picks which combinations fit. Assembly needs no writing model at all and can produce thousands of candidates in seconds.
- Gate them (stage 2), tag them (the same tags as stage 3), and drop near-duplicates of the brand's recent posts.
- Keep the top few **per hook type**, not the overall top, and hold a slot or two for unscored wildcards. Picking the overall top of one scorer makes everything sound the same.
- You pick from the shortlist.

### 5. A fitted layer, trained on real videos

- The hosted models can't be fine-tuned. The training happens outside them: each video's answers become a row of features, and a small model learns which features go with above-normal results.
- It trains first on the competitor library, because a new brand has no results of its own, then shifts weight to the brand's own posts as they build up.
- Public numbers are a rough signal: views depend on follower count, posting time and paid promotion as well as the video. Results are measured against each channel's own norm and by age of the post, and paid posts are left out where they can be told apart.
- It stays off until it beats chance on videos it hasn't seen. Expect that to need a few hundred videos with results.
- Drafts are scored from a low-resolution preview render, not the script alone, so a draft is read the same way the training videos were.

### 6. Results overrule scores

Import results for posted videos and carousels. When variants are posted, later effort moves toward what performs, and the fitted layer is refit. A score is only ever a starting guess.

### 7. A daily carousel batch

- Carousels are the best first target. They are stills and text, so a scorer reads all of a post cheaply, with none of the video limits.
- One command produces the day's batch (say five to ten carousels) from the brand's research: each is gated, tagged and checked against recent posts, so nobody has to review every one.
- Posting daily is also what makes the fitted layer possible. A few hundred posts with results takes one to two months at this rate.
- **One post on three platforms is one piece of content with three results**, not three pieces. Each platform's result is kept separately, which shows what works where, but the count of distinct posts is what the fitted layer learns from.
- **Several accounts means several angles**, not copies. Give each account its own audience or angle and it becomes a clean test of that angle. Posting the same carousel from several accounts on one platform teaches nothing new and is the kind of duplication platforms penalise.
- Posting and scheduling are out of scope here. LaunchClip produces the batch and reads the results back.

### 8. Read the video, cheaply

Not built. The first real library (407 TikTok posts from one keyword) showed that caption wording alone separates nothing: none of 30 drafted questions passed. The hook, the script, the visuals and the pacing are in the video, so the library has to read it, and it has to stay cheap at hundreds to thousands of videos.

`launchclip score library signals <library.jsonl>` adds, per post:

| Signal | How | Model cost |
|---|---|---|
| Pacing | Local, with ffmpeg: length, number of cuts, cuts a second, seconds to the first cut | None |
| Script and spoken hook | The platform's own subtitles when the scrape returns them, else local transcription. The first sentence is the hook. Words a second and seconds to the first word are computed | None |
| Visuals | One contact sheet a video: frames at 0, 1 and 3 seconds and at each of the next few cuts, tiled into one image and scored by the image scorer | One small image a post |

- **Download a sample, not the library.** For each creator, their best few and worst few posts by outlier (default 5 and 5). That is the contrast the drafter needs, at about a third of the downloads.
- **Fetch soon after discovery.** Video links expire. The download step is its own stage with a cache keyed by post id, so a rerun never downloads or scores a post twice.
- **Numbers are features, not questions.** Cuts a second and seconds to the first word go to the drafter and the fitted layer as numbers, banded into low, middle and high within the library. No model is asked to judge pacing.
- **What a contact sheet cannot see:** motion, sound, music, and how an edit feels. It judges the opening frame, on-screen text, framing and whether a person is on camera.
- The video-watching scorer (stage 1) stays as an option for a small audit sample, to check that the cheap signals agree with it.

The drafter then proposes questions per part (hook, script, visuals) and tests each as it does now.

### 9. When a rubric is done

A rubric is never finished, but a version is ready to use when all of these hold:

1. **Enough posts to judge.** 100 or more held-out posts a question (already enforced).
2. **It survives a second sample.** Draft on one discovery run, then test the kept questions on a fresh run with other creators. A question is kept only if its direction holds in both.
3. **It stops changing.** Adding the next 100 posts changes no kept question.
4. **It predicts held-out posts.** The kept questions together rank held-out posts better than a shuffled baseline (the fitted layer's own test).

`score rubric draft` reports these as a short status: posts judging, questions kept, questions that held on the second sample, and whether the last batch changed anything. Expect a few hundred to a thousand posts for a niche. Formats drift, so a rubric is redrafted on fresh posts every month or two, and a brand's own results replace the library as soon as there are enough of them.

### 10. Formats across industries

Not built. A post has a format (how it is built) and a topic (what it is about). The format is what can move between industries.

- **One format rubric for every library.** A shared set of choice questions about structure, answered from the signals in stage 8: the kind of opening, the structure (list, before and after, story, reaction, demonstration), who is on screen, how text is used.
- **Several keywords, several industries.** `library discover` already takes a keyword list. Each library keeps its niche name, and the niche map is made per niche.
- **`score library compare <a> <b>`** lists formats that go with above-normal results in niche A and are rare or absent in niche B. Those are candidates to import, not findings.
- **A general trending feed is a source of creators and formats, never of proof.** Third-party actors exist for TikTok's trending and top-ads lists. They return hits only, so they are used as the keyword search is: to find creators, whose whole recent feeds are then collected, and to suggest format names for the shared rubric.
- **Imports are tested, not trusted.** An imported format gets the shortlist's wildcard slots (stage 4), and the brand's own results decide whether it keeps them (stage 6). Nothing shows that a format which wins in one industry wins in another.

## Limits to design around

Video through Gemini Decision 1, from its documentation:

- One request holds about 262,000 tokens across the media and all questions, with up to 1,000 questions.
- Files go inline (up to 100 MB), by public or signed link (up to 15 MB), or by upload. YouTube links are not accepted.
- No batch mode and no caching: every request is charged in full, and bulk runs are many requests at once.
- Resolution can be set low, medium or high per video. Frames are sampled, so very fast cuts or one-frame text may be missed.
- Questions are text only. It returns no explanation for an answer.
- Requests that trip a safety filter are rejected outright.

Other limits:

- Jev takes no audio or video. A video must be reduced to a transcript and sampled frames.
- Local open models run on a 16 GB Mac but agree with the reference less often and are overconfident when wrong.
- Content from the web can argue for its own score. Research input is treated as untrusted and never triggers an action by itself.

## Not doing

- A cold "virality" or "quality" score. There is no evidence one works.
- Simulated audience panels. They did worse than a single plain question.
- Bundling or redistributing a closed model, or shipping a copy trained on a closed model's answers before its terms are checked.

## Open questions

- Is a local model accurate enough to gate on? Stage 0 answers this.
- What does a short video cost to tag? Estimated at well under a cent, not yet measured.
- Does any tag predict results in a given niche? Only the stage 3 library can say.
- How few of a brand's own posts are enough before its results should outweigh the competitor library?
