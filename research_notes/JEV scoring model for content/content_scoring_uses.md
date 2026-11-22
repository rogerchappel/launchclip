# "JEV" and comparable scoring models for marketing and short-form content (as of 22 Nov 2026)

Reading notes for the writer:
- "Jev-specific" and "general practice" are kept apart inside every section.
- Labels used: **[vendor]** = maker's claim, **[3p-vendor blog]** = a marketing/ad-tool company blog (interested party, mostly not hands-on), **[author-reported]** = an individual's unreproduced run, **[paper]** = arXiv/peer-review, **[docs]** = integration partner documentation.
- Several facts reached me only through search-result summaries rather than a full page read; those are marked "(search summary only)".
- Model names such as "GPT-6", "Claude Opus 5", "GPT-5.6 Sol" appear in the sources as written; I did not verify them independently.

## Which model is "JEV"? (identification)

### Takeaway
Almost certainly **Jev, by TypeSafe AI** (model id `typesafe/jev`), a hosted "System One" decision model released in early access on 15 Sept 2026: it generates no text and returns typed answers (yes/no probability, one-of-N choice, ordered score) with probabilities. Confidence: high (~90%+); the name, the "not a chat model", "scoring model" and "thousands at a time" descriptions all match, and nothing else found fits as well.

### Cited Findings
- Jev (`typesafe/jev`, output version `jev-1.13.0`) "evaluates one state against typed" questions of three kinds: Noul (true/false), Choice (one option of several) and Score (position on an ordered scale); each answer carries probabilities and a confidence value. Inputs: a `state` (text or structured data), optional `assets`, and `questions`. 32,000-token context. Image input is "beta ... not recommended for production". Price $0.042 per 1M input tokens, $0 output. [docs] — [Cloudflare model page](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- TypeSafe's own docs: System One models "do not write replies, produce code, or generate explanations of their reasoning"; primitives are Choice, Score, Noul and Box (image coordinates); probabilities "are optimized against outcomes to reflect uncertainty"; calibration holds over groups of predictions and "does not guarantee that an individual answer is correct". No mention of fine-tuning, few-shot references, custom calibration, pairwise/ranking primitives or video. [vendor] — [TypeSafe docs: System One](https://docs.typesafe.ai/concepts/system-one)
- First public model from TypeSafe AI, early access 15 Sept 2026; described as non-autoregressive with answers "sampled in parallel"; training method named "Reinforcement Learning for Calibrated Decisions (RLCD)"; homepage headline "193.6x Faster, 444.6x Cheaper"; another explainer gives 40-200x faster / 40-400x cheaper. The two ranges conflict and neither is independently verified. Jev 1.14 reported available on a gateway 15 Oct 2026. (search summary only) — [TypeSafe home](https://typesafe.ai/); [DataCamp explainer](https://www.datacamp.com/blog/system-one-models-jev); [Vercel explainer](https://vercel.com/i/what-is-jev)
- Launch out of stealth 15 Sept with a $40M seed led by DCVC; waitlist access, API-only, no open weights, no self-hosting; latency 70-500 ms [vendor figure relayed]; one decision call priced at $0.000081 on the homepage. [3p-vendor blog] — [Bir.ch guide for advertisers](https://bir.ch/blog/jev-guide-for-advertisers)
- Founder named as Diogo Almeida. [3p-vendor blog] — [Ryze: Jev for Marketing](https://www.get-ryze.ai/blog/jev-for-marketing)
- Integration limits in one eval tool: 1-50 questions per evaluator answered in one call, 2-255 Choice options, 2-10 ordered Score levels; yes/no stored as P(true) in 0-1 with a user-chosen threshold. [docs] — [Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/jev-as-a-judge.md)
- Score answers are a probability-weighted average of the levels; confidence reflects how concentrated the answer distribution is; an `insufficient_context` option exists but does not guarantee abstention. [docs] — [Pydantic article](https://pydantic.dev/articles/jev-evals.md)
- Name collisions to ignore: an open-weights "student" model `autotrust/JEV` on Hugging Face that is explicitly not affiliated with TypeSafe (search summary only) — [Hugging Face](https://huggingface.co/autotrust/JEV). A competing product, OpenAI's "Decisions API" (announced 29 Sept, ~150 ms, limited preview), is the same category. [3p-vendor blog] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)

### Inferences
- "Scoring thousands of things at a time" matches the viral demos (4,367 ads in 39 s; 10,000 search terms in 12 s), which is likely where the description came from.
- Because there is no pairwise/ranking primitive, "ranking hooks" with Jev means scoring each hook independently on a rubric (Score 2-10 levels, or a Noul probability) and sorting, or encoding a pair into the state and asking a Choice.
- Other candidates considered and rejected: Meta's TRIBE v2 brain-response predictor (used by creator tools for hook scoring, but is not "LLM-style" and is not fast batch scoring of text); rerankers/embedding models (no name match).

### Gaps
- I did not read TypeSafe's launch post or benchmark page directly; the vendor benchmark and speed numbers reach these notes via third parties.
- No published rate limits or throughput table found; "thousands at a time" throughput is evidenced only by individual runs.

## What has the maker or community shown Jev doing for content, marketing, ads, social video or copy?

### Takeaway
Documented Jev content use is almost entirely **classification and triage at scale** (tagging ads by hook/format/offer, intent-labelling search terms, QA gates, ad-to-landing-page consistency), shown as speed-and-cost demos. I found **no** maker example and no community run where Jev ranks hooks or scripts and the ranking is checked against real performance.

### Cited Findings
- The maker's and gateway's own examples are not marketing: refund review, support routing, account risk scoring, frustration scoring, car-damage boxes. [vendor/docs] — [TypeSafe docs](https://docs.typesafe.ai/concepts/system-one); [Cloudflare](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- Author-reported runs collected by an ad-tool blog (none independently reproduced): 4,367 Meta ads from 38 companies tagged in 39 s for $0.27; 1,000 live ads from 52 brands reviewed in under a minute for under $0.06; 10,000 Google search terms classified by intent in 12 s for about $0.03; 29,919 judgments over 112 live Meta ads for about $0.23, finding 80% of judgeable ads land on a page that drops the ad's promise; a video-ad team used it to pick one product from 17, score 100 photos and review 20 generated video ads, with no accuracy figures; one user turned two years of account decisions into scoring criteria (no figures). "No run reports CTR, ROAS, or hold-rate results." [author-reported via 3p-vendor blog] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)
- Further demos: 724 ads from 37 brands labelled in 40 s for about 9 cents (X post, 17 Sept 2026); 586 pages of internal links mapped in 45 s for 21 cents; 700 leads scored for about $0.09. Eight proposed marketing jobs: search-term negatives, creative tagging (Choice x4), internal link map, AI-citation checks, lead scoring/routing, review/survey themes, a content QA gate (Noul x20), model routing. The blog's own Meta and SEO demos are labelled "simulated"; the author states it does not run Jev in production. [3p-vendor blog] — [Ryze](https://www.get-ryze.ai/blog/jev-for-marketing)
- A proposed (explicitly not run end to end) six-step creative loop: pull 90 days of ad spend/CPA/ROAS; Jev tags each ad's hook type (problem / demo / social proof / offer / curiosity), awareness stage and creator-to-camera style; plain code joins tags to CPA/ROAS, keeping a pattern only with at least 10 ads and 50 purchases; an LLM writes briefs; a generator makes ads; Jev pre-flights each creative against its brief (opening matches the hook, product named in first line, risky claims). Video needs a written description of the opening because Jev "cannot watch video". [3p-vendor blog] — [Shhots](https://shhots.ai/blog/jev-ai-meta-ads-mcp-creative-loop/)
- Other blogs describe scoring 100 ad variations to decide which hooks or angles to test first, and warn that an ambiguous criterion is classified "fast but badly". (search summary only) — [Creativa](https://www.creativa.ai/en/blog/jev-large-decision-model-ad-classification-at-scale)
- Reliability warning on the social proof itself: the most viral Jev post was reportedly copied word for word by three accounts, two of them employees of one company, and TypeSafe faced a public callout over this. [3p-vendor blog] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)

### Inferences
- The realistic, evidenced role for Jev in a content pipeline is the cheap wide stage: label, filter, gate and route thousands of candidates or reference items; an LLM still writes, and something else (live data) still decides what performs.
- The "tag then join to your own performance data in code" pattern is the most defensible Jev content workflow found: Jev supplies consistent features, the brand's own numbers supply the outcome.
- For research triage (relevance filtering before an LLM reads), the fit is direct: a Noul "is this relevant to X" over thousands of items, escalate the middle confidence band.

### Gaps
- No TypeSafe-published marketing/content case study found.
- No documented use on scripts, retention prediction, or short-form video (no video input; image input beta).
- All speed/cost demos are single unreproduced posts, in an environment with reported astroturfing.

## What does the score correlate with? Validation against real outcomes

### Takeaway
For Jev there is **no evidence of any kind** linking its scores to views, 3-second hold, retention, CTR or conversions. What is validated is agreement with correct labels on judge benchmarks, where it is near a frontier LLM for verdicts readable from the text and clearly worse when the verdict must be reasoned out; on reference-free prose quality it is at chance (as is every judge tested).

### Cited Findings
**Jev-specific**
- CMU paper "JEV-as-a-Judge" (Li, Miao, Krishnan, Padman), Jev vs 16 other judges. Accuracy Jev / GPT-6: RewardBench 92.5% / 92.5%; JudgeBench 78.6% / 93.1%; HaluEval 87.3% / 88.4%; final-answer set 94.0% / 96.7%. Jev "comes within three points of GPT-6 wherever a verdict can be read off the text" and "falls behind where the verdict must be derived". [paper] — [alphaXiv 2609.26550](https://www.alphaxiv.org/abs/2609.26550.md)
- Same paper, most relevant to copy scoring: on **reference-free prose** judgments Jev scored 53.5% vs 56.0% for an LLM judge, error-detection AUROC 0.498; "no tested judge is usable there". On RM-Bench hard pairs, where the worse answer is more elaborately written, Jev 76.6% vs 90.1%. Logic puzzles 68.4% vs 95.9%. [paper] — [alphaXiv 2609.26550](https://www.alphaxiv.org/abs/2609.26550.md)
- Same paper, confidence is informative: AUROC of top-label probability for Jev's correctness 0.88 / 0.73 / 0.83 (RewardBench / JudgeBench / HaluEval); at confidence >= 0.9 accuracy on accepted items 94.7%; confident errors 2.1% of RewardBench judgments. A cascade (accept Jev at >= 0.9, else escalate) scored 93.4% vs 92.5% for the big judge alone, escalating 31.5% of pairs at 41.4% of the cost; on new workloads it escalated 74.2%. Cost $0.044 vs $12.182 per 1,000 judgments (~277x); median latency 0.15 s vs 1.89 s. Limits: one proprietary version, black box, partial human adjudication. [paper] — [alphaXiv 2609.26550](https://www.alphaxiv.org/abs/2609.26550.md)
- TypeSafe's own four-workflow benchmark, relayed by third parties: Jev 67.8% vs 73.1% and 74.1% for two frontier LLMs; not independently reproduced; a blog calls this "triage-grade" and advises testing on 500 hand-labelled rows. [vendor via 3p-vendor blog] — [Ryze](https://www.get-ryze.ai/blog/jev-for-marketing)
- One user's lead-scoring run missed 40% of the contacts his reference model marked worth contacting. [author-reported] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)
- A blog's demo scores "ad survival likelihood" and treats 60-day survival as proof of profit; the same page says there is no evidence for either. [3p-vendor blog] — [Ryze](https://www.get-ryze.ai/blog/jev-for-marketing)
- An integration write-up reports no accuracy versus human labels; its eight cases are synthetic. [docs] — [Pydantic](https://pydantic.dev/articles/jev-evals.md)

**Comparable scorers (general practice)**
- Trained multimodal engagement predictors do correlate with real short-video outcomes: on SnapUGC (120,651 Snapchat Spotlight videos, 5-60 s, >2,000 views each) the target is ECR = share of viewers who watch at least 5 s; best challenge entry SROCC 0.707 / PLCC 0.714, baseline about 0.66; a text-only entry (title, description, music category) reached 0.441; ECR correlates 0.928 with normalised average watch percentage; video-quality models "struggle to predict the popularity of short videos". [paper] — [VQualA 2025 challenge](https://arxiv.org/html/2509.02969)
- The winning approach fine-tuned large multimodal models; the one with audio input consistently beat the frames-and-text one. [paper] — [arXiv 2508.02516](https://arxiv.org/abs/2508.02516)
- Zero-shot LLM click-intent ranking of headlines against the Upworthy A/B archive: on the 399 tests with a reliable winner, top-1 accuracy 49.2% (random 30.4%), Kendall tau 0.361; across all 1,695 tests tau falls to 0.054. Only 23.5% of tests have a statistically reliable winner. No signal at all on Reddit title reposts. [paper, author has a commercial interest] — [arXiv 2609.25010](https://arxiv.org/html/2609.25010v1)
- Multimodal LLM judging web-page A/B screenshots (546 tests from a CRO agency): chance-corrected agreement kappa 0.141 overall, 0.108 on significant tests (inconclusive). 15 human experts scored at chance (kappa about -0.03). Different judge models agree with each other (kappa 0.74-0.88) far more than with outcomes (about 0.2). A frontier model was statistically no better than a small one. [paper, company's own product] — [arXiv 2608.07517](https://arxiv.org/html/2608.07517v1)

### Inferences
- A Jev rubric score on a hook measures "does this text satisfy the stated criterion", not "will this perform". Whether it predicts performance depends wholly on whether the criterion does, and that must be tested on the brand's own results.
- The 0.498 AUROC on reference-free prose is the closest published analogue to "score this hook's quality cold", and it is a null result. Scoring against explicit, checkable criteria (has a concrete number, names the audience, opens on the payoff) is where Jev is strong.
- The realistic ceiling for content-only prediction of early retention, with a model trained on 100k+ labelled videos and seeing the actual video and audio, is roughly rank correlation 0.7; text-only about 0.44; zero-shot text judging of headlines about 0.35 on clean tests. A text-only zero-shot rubric scorer should be expected to sit at or below the bottom of that range.

### Gaps
- No study of any decision model (Jev or OpenAI's) against social or ad performance data.
- I could not confirm what "outcomes" Jev's probabilities are calibrated against; the docs do not say.
- SnapUGC is one platform with a 5-second label; nothing found mapping to a 3-second hold on other platforms.

## Established methods for pre-testing creative with models: what works and what does not

### Takeaway
What holds up: (a) predictors trained on real platform outcomes, (b) model scores used as a prior that a live bandit corrects, (c) confidence-gated use (act on confident calls, abstain or escalate otherwise), and (d) cheap scorers as wide filters ahead of expensive judges. What has been shown weak or misleading: zero-shot LLM winner-picking, demographic persona panels, and headline "accuracy" numbers on win-skewed catalogues.

### Cited Findings
- **Generate-many-then-rank with a trained predictor:** an academic pipeline has an LLM write titles and video prompts and scores the generated videos with an offline, pre-trained popularity predictor. (search summary only) [paper] — [LLMPopcorn, arXiv 2502.12945](https://arxiv.org/pdf/2502.12945)
- **Pure-LLM prediction is weak on its own:** on 17,681 Upworthy headline A/B tests, prompt-based approaches "perform poorly"; embedding models and a fine-tuned Llama-3-8B reach only "marginally higher accuracy than random". [paper] — [LOLA, arXiv 2406.02611](https://arxiv.org/abs/2406.02611)
- **LLM prior + bandit works best:** LOLA feeds the best LLM predictor into an Upper Confidence Bound bandit that allocates live traffic; it beats standard A/B tests, pure bandits and pure-LLM approaches, "especially when experimental traffic is limited". [paper] — [LOLA](https://arxiv.org/abs/2406.02611)
- **Simulated audiences / personas:** a 10-persona panel was significantly worse than a single generic-reader prompt (tau 0.084 vs 0.361; top-1 34.6% vs 49.2%), robust across seeds, prompt wordings, six aggregation rules and a second model; the authors call personas "worse than not using them" for ranking copy. Cited prior work: persona variables explain under 10% of annotation variance; personas in prompts do not improve and can degrade performance. [paper] — [arXiv 2609.25010](https://arxiv.org/html/2609.25010v1)
- **Vendor counter-claims, unverified:** synthetic-panel vendors claim 85-95% "predictive parity" with human surveys and a 95% correlation in a third-party double-blind test; another claims 78% click-through prediction accuracy. These measure agreement with surveys or internal benchmarks, not live A/B results, with no published method. (search summary only) [vendor] — [neuroflash](https://neuroflash.com/blog/testing/synthetic-audiences-vs-ab-testing/); [SOMIN](https://somin.ai/blog/predict-ad-performance-before-you-spend-creative-pre-testing/)
- **Accuracy artifacts:** a rule that always picks the changed variant scores roughly 75-85% on curated test libraries (93.9% on one slice) with zero decision value; about 44% of "ground truth" labels came from non-significant tests; recommendation is chance-corrected metrics stratified by significance. [paper] — [arXiv 2608.07517](https://arxiv.org/html/2608.07517v1)
- **Confidence gating:** calling a winner only when a 16-20-vote panel's margin is >= 0.6 covers about 49% of tests and lifts kappa to 0.311 on significant labels (exploratory); a 9-vote panel keeps this at about half the cost. [paper] — [arXiv 2608.07517](https://arxiv.org/html/2608.07517v1)
- **Dedicated scorer vs LLM judge:** the decision model matches a frontier judge where the verdict is on the page, at ~277x lower cost and ~12x lower latency, and a cascade recovers the rest. A decision model answers many typed questions in one call; an LLM judge is the choice when written reasoning is needed. [paper]/[docs] — [alphaXiv 2609.26550](https://www.alphaxiv.org/abs/2609.26550.md); [Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/jev-as-a-judge.md)
- **Engagement predictors trained on platform data:** fine-tuned multimodal LLMs lead on 5-second continuation (SROCC about 0.71); audio matters. [paper] — [VQualA 2025](https://arxiv.org/html/2509.02969); [arXiv 2508.02516](https://arxiv.org/abs/2508.02516)
- **Neural/attention response predictors:** third-party tools wrap Meta's TRIBE v2 (predicts fMRI-style responses over ~20,000 cortical points from text, audio, video) into per-second "activation" and virality scores for clips up to 60 s. Sources note it models an average viewer, predicts neural activation "not views or sales", one project reported a normalisation bug that reversed a test pair's winner, and the weights are CC-BY-NC (non-commercial). No independent study links these scores to engagement. (search summary only) — [Replicate model readme](https://replicate.com/prakhar-bhartiya/meta-tribev2-social-media-content-signal/readme); [Devpost project](https://devpost.com/software/loopy-9ev74g)
- **Benchmark-driven hook taxonomies:** an ad-analytics firm ranks 25+ hook tactics on Meta by hit rate and spend-use ratio over 1 Sept 2025 - 1 Jan 2026. (search summary only) [vendor] — [Motion creative benchmarks 2026](https://motionapp.com/library/research/creative-benchmarks-2026/top-hook-tactics)

### Inferences
- Best-supported pipeline shape for a small producer: LLM generates many candidates; a cheap scorer removes rule-breakers and tags each candidate with features; a prior ranks the survivors; live posting with bandit-style allocation supplies the truth; winners feed the next round's criteria.
- Pairwise tournaments specifically: I found no content-performance study isolating pairwise against pointwise scoring. The judge benchmarks above are pairwise, so pairwise is where the scorers are best characterised, but that is not evidence it predicts engagement better.
- Shipping a persona panel is hard to justify on current evidence; a single well-specified audience description is at least as good and far cheaper.

### Gaps
- No rigorous head-to-head of LLM-as-judge vs dedicated scorer on creative performance.
- No independent validation of neural-response scorers against engagement.
- Engineering write-ups from large ad platforms on generate-then-rank creative systems were not retrieved in this pass.

## Per-brand calibration with little data

### Takeaway
Jev itself offers **no documented tuning path** (no fine-tuning, few-shot references or custom calibration), so brand adaptation has to live outside the model: in the rubric wording, in a small fitted layer over its typed outputs, and in live feedback. The literature supports embeddings-plus-regression and bandits; it gives sample sizes for large publishers, not small brands, and suggests hundreds of clean outcomes are needed before a calibration claim is statistically meaningful.

### Cited Findings
- TypeSafe's docs list only the model alias and four primitives; nothing on fine-tuning, reference examples or custom calibration. Access is API-only, no weights. [vendor]/[3p-vendor blog] — [TypeSafe docs](https://docs.typesafe.ai/concepts/system-one); [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)
- Community practice for Jev: one practitioner converted two years of account decisions into scoring criteria (no results reported); blogs advise hand-checking 20-30 tags, validating on 500 hand-labelled rows, and routing the middle confidence band to a person. [author-reported]/[3p-vendor blog] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers); [Ryze](https://www.get-ryze.ai/blog/jev-for-marketing); [Shhots](https://shhots.ai/blog/jev-ai-meta-ads-mcp-creative-loop/)
- Tag-then-join thresholds proposed for ad accounts: keep a pattern only with at least 10 ads and 50 purchases (the 50 is borrowed from Meta's learning-phase guidance); small accounts give noisy rankings; tag winners are hypotheses, not causes. [3p-vendor blog] — [Shhots](https://shhots.ai/blog/jev-ai-meta-ads-mcp-creative-loop/)
- Linear probe / fine-tuned head: regression on LLM text embeddings and LoRA fine-tuning of an 8B model were both tried on 17,681 headline tests and were only marginally better than random alone, but useful as the prior inside a bandit. A related working paper uses linear regression on 256-dimensional embeddings. [paper] — [LOLA](https://arxiv.org/abs/2406.02611); [MSI working paper 24-150](https://thearf-org-unified-admin.s3.amazonaws.com/MSI_Report_24-150.pdf) (the latter: search summary only)
- Bandits over live posts: the LLM-prior + UCB design helps most "when experimental traffic is limited". [paper] — [LOLA](https://arxiv.org/abs/2406.02611)
- Cold-start alternative: an LLM generates the weights of a linear CTR model from few-shot examples, training-free, for new ads. (search summary only) [paper] — [LLM-HYPER, arXiv 2604.12096](https://arxiv.org/html/2604.12096)
- Data-needs yardsticks: only 23.5% of 1,695 headline tests had a reliable winner; a judge benchmark of about 330 tests could not settle a kappa near 0.1-0.3; about 140 confident calls were estimated necessary for 80% power at kappa 0.30. [paper] — [arXiv 2609.25010](https://arxiv.org/html/2609.25010v1); [arXiv 2608.07517](https://arxiv.org/html/2608.07517v1)
- Zero-shot LLMs underperform a fine-tuned BERT at predicting social-media engagement actions. (search summary only) [paper] — [arXiv 2502.12073](https://arxiv.org/pdf/2502.12073)

### Inferences
- With Jev, the practical adaptation ladder is: (1) write the brand's known winning/losing traits into Score legends and Noul questions; (2) put a few reference posts in the `state` as context (untested, uses the 32k window, costs input tokens); (3) treat the vector of Jev answers as features and fit a small regularised linear model on the brand's own posts against the outcome; (4) let a bandit over live posts override all of it.
- A brand with tens of posts cannot validate a scorer: with roughly a quarter of comparisons being decisive and effects around tau 0.3, low hundreds of posts with outcomes are needed before "the score works for us" is more than noise. Until then, scores are a tie-breaker.
- Because judge models agree with each other much more than with reality, swapping one scorer for another is not validation; only outcomes are.

### Gaps
- No published learning curve (performance vs number of brand examples) for brand-level engagement scoring.
- No documented test of few-shot references inside a Jev state, and no statement on whether TypeSafe plans tuning.
- No small-creator bandit study on organic short-form posts found; evidence is from publisher headline tests and paid ads.

## Known pitfalls

### Takeaway
The documented failure modes are: trusting fast confident labels with no rationale, mistaking judge agreement or survivorship for performance, text-only scoring of what is really a video, convergence to sameness, and stale or platform-specific signal. Novelty decay and score gaming are widely asserted but thinly evidenced for this exact setting.

### Cited Findings
- **No rationale, fast wrong answers:** Jev returns no explanation, so a wrong tag cannot be interrogated; ambiguous criteria are classified "fast but badly"; schema validity (0% structured-output errors) is not correctness; one practitioner's line: "cheap AI can help you make bad decisions at extraordinary speed". [3p-vendor blog] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers); [Ryze](https://www.get-ryze.ai/blog/jev-for-marketing)
- **Elaborate-looking text fools the scorer:** where the worse answer is more elaborately written, Jev's accuracy drops to 76.6% and its confidence becomes less reliable (AUROC 0.764). [paper] — [alphaXiv 2609.26550](https://www.alphaxiv.org/abs/2609.26550.md)
- **Text score vs rendered video:** Jev cannot watch video; a written description stands in for the opening, and a person still has to watch every video. Trained predictors show the gap: text-only 0.441 vs full multimodal 0.71, and audio adds signal. [3p-vendor blog]/[paper] — [Shhots](https://shhots.ai/blog/jev-ai-meta-ads-mcp-creative-loop/); [VQualA 2025](https://arxiv.org/html/2509.02969)
- **Survivorship as a proxy:** public ad libraries carry no spend, CPA or ROAS for ordinary ads; ad longevity is a signal, not a performance measure. [3p-vendor blog] — [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)
- **Inflated accuracy and shared priors:** win-skewed catalogues reward always-pick-the-variant; judges agree with non-significant labels more than significant ones, attributed to a prior shared with the human labeller. [paper] — [arXiv 2608.07517](https://arxiv.org/html/2608.07517v1)
- **Distribution shift across platforms and time:** a headline ranker with signal on one publisher's tests had none on Reddit; the benchmark data are English editorial headlines from 2013-2015 with possible training contamination. Industry pieces warn a model trained on one quarter's data goes stale as sentiment shifts. [paper]/(search summary only) — [arXiv 2609.25010](https://arxiv.org/html/2609.25010v1); [Influencers Time](https://www.influencers-time.com/ai-assisted-creative-testing-at-scale-before-you-spend/)
- **Convergence to sameness:** restaurants with ChatGPT access produced more similar Instagram content; a ban was associated with about 3.5% more likes on average (search summary only) — [SSRN 5367123](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5367123). Frontier model outputs measured 66.2% more homogeneous than human writing on Self-BLEU and 27.3% on embedding similarity (search summary only) — [arXiv 2611.14828](https://arxiv.org/pdf/2611.14828). Group-level idea diversity fell with LLM assistance in a 36-person study (search summary only) — [arXiv 2402.01536](https://arxiv.org/pdf/2402.01536)
- **Optimising the proxy has side effects:** LLM-assisted content raised short-term engagement while reducing informational depth and perceived authenticity; naive engagement optimisation of news amplified polarisation. (search summary only) [paper] — [MDPI Electronics](https://www.mdpi.com/2079-9292/15/13/2820); [arXiv 2504.13444](https://arxiv.org/pdf/2504.13444)
- **Vendor and price risk:** launch price may be subsidised (the maker reportedly says it cannot prove otherwise), waitlist-only, no GA date, no rate-limit table. [3p-vendor blog] — [Ryze](https://www.get-ryze.ai/blog/jev-for-marketing); [Bir.ch](https://bir.ch/blog/jev-guide-for-advertisers)

### Inferences
- Score gaming is the generator-scorer version of the "elaborate answer" weakness: a generator iterated against a fixed rubric will learn to satisfy the rubric's surface. Mitigations consistent with the evidence: hold out some slots for unscored or low-scored exploration, add an explicit similarity/novelty check against recent posts, and rotate criteria from live results.
- Selecting the top of thousands by one scorer compounds homogenisation: generator sameness plus a single selection criterion. Diversity has to be an explicit constraint (pick top-k per hook type or angle, not global top-k).
- Use Jev's confidence as the published evidence supports: act automatically only on high-confidence answers, send the rest to a stronger judge or a person.

### Gaps
- No quantified study of novelty decay or creative fatigue for model-selected short-form hooks was found.
- No direct study of generator-vs-scorer gaming in marketing copy.
- No published evidence on how Jev's calibration behaves on subjective marketing criteria (its calibration evidence is on correctness benchmarks).
