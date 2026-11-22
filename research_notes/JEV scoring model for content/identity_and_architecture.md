# JEV: identity and architecture (as of 22 November 2026)

Research note on sourcing: every fact below comes from pages fetched on 22 Nov 2026. Vendor pages (typesafe.ai, docs.typesafe.ai) are primary for what the maker claims; they are not independent evidence that the claims hold. One independent review (ai.plainenglish.io) returned HTTP 403 and was not read; only its search snippet is used, and it is marked as such.

## What exactly is the model, its full name and what the acronym stands for?

### Takeaway
The model is almost certainly **Jev** (written "Jev", sometimes "JEV"), the first "System One" model from TypeSafe AI: a non-generative decision/scoring model that takes a state plus typed questions and returns scores and probabilities, never text. "Jev" is not an acronym; it is named after the economist William Stanley Jevons (Jevons paradox). Confidence in the identification: high (about 90%). The one serious alternative is Google's Gemini Decision 1, which does the same job but is not called anything like "JEV".

### Cited Findings
- Jev is "TypeSafe's first System One Model", described by the maker as "a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out". — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- The name is after William Stanley Jevons; "System One" borrows from Kahneman's fast/intuitive System 1. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- The Register confirms the name refers to Jevons and the Jevons paradox (cheaper tokens drive more token use). — [The Register](https://www.theregister.com/a/5296711)
- Jev "cannot generate text at all"; it is "not a chatbot". — [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/09/jev-explained/)
- Cloudflare lists it as "TypeSafe's structured evaluation model", model ID `typesafe/jev`. — [Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/models/typesafe/jev/)
- A Carnegie Mellon paper writes the name in capitals ("JEV") and calls it "a decision-only LLM judge that returns label probabilities instead of text". — [JEV-as-a-Judge, arXiv:2609.26550](https://www.alphaxiv.org/abs/2609.26550.md)
- Nearest alternative: Gemini Decision 1 (`gemini-decision-1`), launched 11 Nov 2026, answers up to 1,000 yes/no, multiple-choice or rubric-scoring questions per request in one forward pass. — [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/)
- LLM-JEPA (Huang, LeCun, Balestriero; arXiv Sept 2025, ICLR 2026) is a training objective that adds an embedding-space JEPA loss to next-token loss; the search found nothing tying it to fast batch scoring. — [LLM-JEPA, arXiv:2509.14252](https://www.arxiv.org/abs/2509.14252)

### Inferences
- Fit against the user's description, ranked:
  1. **Jev (TypeSafe AI)**, about 90%. Matches every clue: name sounds exactly like "JEV"; "LLM-style but not a chat model"; "a scoring model" (Score is one of its answer types); "really fast at scoring thousands of things" (public demos score 700 to 6,245 items in 25 to 40 seconds); recent (Sept 2026).
  2. **Gemini Decision 1 (Google DeepMind)**, about 7%. Same category and literally "1,000 questions per request", but the name does not sound like "JEV". Plausible only if the user conflated the two launches.
  3. **LLM-JEPA or other JEPA-style text models**, under 3%. "JEPA" could be misheard as "JEV", but these are research training objectives, not scoring products, and nothing about them matches "fast at scoring thousands of things".
- Rerankers, reward models and brain-response predictors were not needed as candidates: no model by a JEV-like name turned up in those families, and Jev itself is being used as a reranker and judge.

### Gaps
- No source says "JEV" in capitals is an acronym; the capitalised spelling in the CMU paper appears to be stylistic. Not confirmed with the authors.
- Only the user can confirm which model they meant.

## Who built it (lab/company/authors), and when was it released? Paper, blog post, repo, model card links.

### Takeaway
TypeSafe AI, a startup founded by ex-OpenAI researcher Diogo Almeida, released Jev in early access on 15 September 2026 after two years in stealth, with a $40M seed round. It is a closed, hosted model: there is a vendor blog post, docs and an adapter repo, but no vendor paper and no open weights.

### Cited Findings
- Founder is Diogo Almeida, who says he helped build the OpenAI methods behind ChatGPT. Announcement dated 15 Sep 2026. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- The Register describes Almeida as co-founder and CEO, credited as a co-inventor of RLHF, and reports $40M raised. — [The Register](https://www.theregister.com/a/5296711)
- TypeSafe emerged from two years in stealth on 15 Sep 2026 with $40M seed funding. — [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/09/jev-explained/)
- Current versions: Jev 1.14 (`jev-1.14.0`, available from 14 Oct 2026) and Jev 1.13 (`jev-1.13.0`); `jev-latest` points to 1.14. — [TypeSafe models docs](https://docs.typesafe.ai/models.md)
- Jev is closed; weights and evaluation stack are unpublished. — [Hyperstack tutorial](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model)
- Vendor links: docs at https://docs.typesafe.ai/introduction, console at https://console.typesafe.ai/, workflow evals at https://evals.typesafe.ai/, wrapper repo at https://github.com/typesafe-ai/system-one-adapter-python. No paper link is given. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Also served through Cloudflare (Workers AI / AI Gateway) and Vercel AI Gateway. — [Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/models/typesafe/jev/); [Vercel guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)
- Independent academic paper: "JEV-as-a-Judge: Accept When Confident, Escalate When Unsure", Li, Miao, Krishnan, Padman (Carnegie Mellon), arXiv:2609.26550, v6 dated 29 Oct 2026. — [alphaXiv](https://www.alphaxiv.org/abs/2609.26550.md)
- Independent vendor-adjacent evaluation: LangChain, "Jev-as-a-Judge for Agent Evals", 20 Sep 2026. — [LangChain blog](https://www.langchain.com/blog/jev-agent-evals-langsmith)

### Inferences
- The search listed a Hugging Face path (huggingface.co/autotrust/JEV) and a community benchmark (jevbench). Neither was opened; given that Jev is closed-weight, the Hugging Face entry is unlikely to be the official model and should not be treated as one.

### Gaps
- Other co-founders, headcount and the full investor list were not confirmed (one search summary named DCVC as seed lead; not verified against a primary source).
- The Register calls Almeida "co-founder"; TypeSafe's page calls him "founder". Other founders are not named in anything read.

## Architecture and training objective: how does it differ from an autoregressive chat LLM? What are its inputs and outputs?

### Takeaway
Jev reads the input once and answers every question in one parallel pass, returning probabilities over answer options the caller declared in advance, instead of generating tokens one at a time. The maker says it uses a new architecture with a "parallel sampler" and a new training method, RLCD (Reinforcement Learning for Calibrated Decisions), but has published no architectural or training detail.

### Cited Findings
- Maker's description: a new model architecture with a parallel sampler; outputs are produced in a single query, not token by token. No further detail given. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Training: RLCD optimises for "epistemically honest probabilities"; the announcement gives no training details, and its FAQ lists "is it just a smaller LLM?" and "where does training data come from?" without answering them on the page. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Inputs: a required `state` (string or JSON object), optional images, and a `questions` object where each question has a type. — [Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/models/typesafe/jev/)
- Answer types: Choice (one option plus a probability per option and a confidence), Score (a numeric position on a caller-defined ordered scale, with probabilities and confidence), Noul (probability 0 to 1 that a yes/no statement is true), and Box (added in 1.14). — [TypeSafe System One docs](https://docs.typesafe.ai/concepts/system-one); [TypeSafe models docs](https://docs.typesafe.ai/models.md)
- Score example from the docs: a 0 to 2 scale (calm to very frustrated) returning a value like 1.4. — [TypeSafe System One docs](https://docs.typesafe.ai/concepts/system-one)
- Score is described as a probability-weighted position on the scale, not a single pick. — [Hyperstack tutorial](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model)
- Choice supports up to 255 options; larger sets use a two-stage process and can be slower. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Context: 64k tokens per request, 32k per question (state plus one question); an opt-in header raises both to 262k at a stated cost in speed and accuracy. Images (PNG, JPEG) supported; audio and video not yet. — [TypeSafe models docs](https://docs.typesafe.ai/models.md)
- No customer fine-tuning: the same weights serve everyone, and behaviour is steered through state, instructions and criteria in the request. — [TypeSafe models docs](https://docs.typesafe.ai/models.md)
- Third-party account of the mechanism: a "restricted softmax" over only the declared answer options in a single forward pass; Hyperstack reproduced the idea with the open Qwen2.5-0.5B-Instruct model. — [Hyperstack tutorial](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model)
- Sceptical view: "System One" is branding; structured output is not unique; the capability probably comes mainly from the base model rather than RLCD; engineers built Jev-compatible APIs from open models (Qwen with SGLang, DiffusionGemma with vLLM) with similar latency. — [Lee Han Chung blog](https://leehanchung.github.io/blogs/2026/09/20/jev-return-ai-ml-engineering/)

### Inferences
- The most likely reading is that Jev is a transformer language model whose output is read as a probability distribution over a constrained label set (prefill only, no decode loop), trained with a calibration-focused objective. This is consistent with token-based pricing, a token context window, natural-language instructions, and the fact that open LLMs reproduce the interface. TypeSafe has not confirmed it and claims a "new architecture".
- The practical difference from a chat LLM for a user: you cannot ask it to explain or write anything, and it can only return values inside the set you defined. It can still be wrong inside that set.

### Gaps
- Parameter count, base model (if any), layer design, and what "parallel sampler" means concretely: not published in anything read.
- RLCD algorithm details: not published. TypeSafe's Machine Learning Primer (https://docs.typesafe.ai/introduction/machine-learning-primer.md) reportedly covers how the model works and is trained; it was not fetched.
- What the Box answer type returns was not checked.

## What does it score, and against what ground truth was it trained or validated?

### Takeaway
Jev scores whatever the caller defines: any state against any rubric, yes/no question or option set written in natural language. It has no built-in notion of "good content" or engagement. What it was trained against is undisclosed, and the vendor's own headline evals use the averaged predictions of two frontier LLMs as the reference rather than human ground truth.

### Cited Findings
- TypeSafe's workflow evals do not use ground-truth labels; they use the average predictions of GPT-6 Astra and Fable 5.1 as reference probabilities. The page does not say what Jev was trained or validated against. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- TypeSafe concedes its evals may favour OpenAI and Anthropic models, used a simplified query and a short state paragraph, and that "0% hallucination" is by design (schema matching), not measured. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Docs say probabilities are "optimized against outcomes" and that calibration holds across groups of predictions, not for any single answer. — [TypeSafe System One docs](https://docs.typesafe.ai/concepts/system-one)
- Intended uses per the maker: classification, routing, scoring, validating AI inputs, real-time decisions, map-reduce classification of large datasets. — [The Register](https://www.theregister.com/a/5296711)
- Independent, human-labelled benchmarks (CMU): RewardBench 92.5% (ties GPT-6), HaluEval 87.3% vs 88.4%, JudgeBench 78.6% vs 93.1%. Pooled over 4,850 public judgments Jev ranks 8th of 15 LLM judges, 1.7 points behind GPT-6. It is competitive when the verdict can be read off the text and falls behind when it must be derived (maths, code, logic). On reference-free prose all judges were near chance. — [JEV-as-a-Judge](https://www.alphaxiv.org/abs/2609.26550.md)
- At confidence 0.9 or higher Jev and GPT-6 are nearly tied (94.7% vs 94.4% on 3,744 items); a cascade that escalates low-confidence items scored 0.9 points above GPT-6 at 41% of its fee. — [JEV-as-a-Judge](https://www.alphaxiv.org/abs/2609.26550.md)
- LangChain: 100% pass/fail agreement with one human labeller over 500 decisions, and score variance 92x to 913x lower than three LLM judges; but only five cases, one agent, one labeller, and the Jev version was not recorded. — [LangChain blog](https://www.langchain.com/blog/jev-agent-evals-langsmith)
- Calibration is contested: one tester reportedly found calibration failures on 7 of 8 datasets across 16.5k predictions, and the blog author found high expected calibration error on simple tests. — [Lee Han Chung blog](https://leehanchung.github.io/blogs/2026/09/20/jev-return-ai-ml-engineering/)
- TypeSafe documents nine failure modes; two named in coverage are arithmetic/dates and large noisy input. — [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/09/jev-explained/)
- Search snippet only (page returned 403, not read): an independent eight-day review titled "Level With Mid-Price LLMs, Behind the Frontier" rated TypeSafe's own evidence as weak. — [AI in Plain English](https://ai.plainenglish.io/jev-after-eight-days-of-independent-tests-level-with-mid-price-llms-behind-the-frontier-05daa8f21e2e)

### Inferences
- For scoring content (hooks, scripts, clips), Jev would be a cheap rubric judge, not a predictor of real audience response. Any score reflects the rubric and the model's general judgement; nothing found shows it trained or validated against engagement, retention or other outcome data.
- The CMU finding that every judge was near chance on reference-free prose is the most relevant caution for subjective creative scoring.
- The low run-to-run variance LangChain reports is expected of a model that returns a probability rather than sampling text; it means repeatable, not correct.

### Gaps
- Training data and training labels: undisclosed.
- No published evidence was found of Jev's scores correlating with real-world content performance.
- The nine documented failure modes were not read in full.

## Why is it fast at batch scoring? Any published throughput numbers.

### Takeaway
It is fast because there is no token-by-token generation: one forward pass over the input yields probabilities for all declared answers, many questions can share one state in a single request, and only input tokens are billed. Published figures are 70 to 500 ms per call (vendor) and 0.15 to 0.44 s measured independently; "thousands at a time" in practice means thousands of parallel requests finishing in tens of seconds.

### Cited Findings
- Vendor latency: 70 to 500 ms end to end, claimed 40x to 200x faster than frontier LLMs on System One-shaped queries; homepage claims 193.6x faster and 444.6x cheaper on its workflow evals. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Independent latency: 0.15 s median and $0.044 per 1,000 judgments, versus 1.89 s and $12.18 for GPT-6 (about 13x faster, 277x cheaper). — [JEV-as-a-Judge](https://www.alphaxiv.org/abs/2609.26550.md)
- Independent latency: 0.44 s average per call and $0.00035 per call, versus 2.16 to 2.83 s for three LLM judges. — [LangChain blog](https://www.langchain.com/blog/jev-agent-evals-langsmith); [Hyperstack tutorial](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model)
- Vendor demo: 0.114 s for Jev versus 8.566 s for GPT-5.6 Terra. — [The Register](https://www.theregister.com/a/5296711)
- User-reported bulk runs: 700 leads in about 40 s ($0.09); 6,245 companies in 25 s ($0.37); 3,247 sessions from 3 million events in about 40 s ($2.17); 464,720 abstracts (about 2.3 million judgments, no timing). — [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/09/jev-explained/)
- Batching questions: per TypeSafe's cookbook, 13 questions in one request ran 12.2x cheaper and 10x faster than asking them separately, with unchanged answers. — [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/09/jev-explained/)
- No cap on the number of questions per request beyond the context limits (64k per request, 32k per question). Rate limits are per organisation in tokens/second and requests/second, values shown only in the console. — [TypeSafe models docs](https://docs.typesafe.ai/models.md)
- Pricing: $0.042 per million input tokens, output free; TypeSafe says it cannot prove the price is not subsidised. — [TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Counterpoint: the latency and cost gap between this approach and a small autoregressive model is argued to be negligible for short prefills; a single-H100 reproduction with Qwen2.5-0.5B got only 1.83x (463 ms scoring vs 848 ms generating). — [Lee Han Chung blog](https://leehanchung.github.io/blogs/2026/09/20/jev-return-ai-ml-engineering/); [Hyperstack tutorial](https://www.hyperstack.cloud/technical-resources/tutorials/jev-inside-typesafe-ais-first-system-one-decision-model)
- For comparison, Gemini Decision 1: 150 to 250 ms end to end, 50 to 100 ms median model compute, latency nearly flat from 1 to 100 questions, up to 1,000 questions per request, 256K-token multimodal input (text, image, audio, video, PDF), $0.10 per million input tokens with output free. — [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/)

### Inferences
- The bulk-run figures imply roughly 17 to 250 items per second through concurrent requests (700/40 s up to 6,245/25 s). These are anecdotes from individual users, not benchmarks, and depend on the account's rate limit.
- The large "200x / 400x" multiples are measured against frontier reasoning models on the vendor's own workflows; against small or non-reasoning models the advantage is much smaller (the vendor itself notes smaller speedups when competitors ran in non-reasoning modes).
- Jev is about 2.4x cheaper per input token than Gemini Decision 1, but Gemini accepts video and audio directly and has a published 1,000-question limit, which matters for scoring video content.

### Gaps
- No official tokens-per-second or requests-per-second throughput figure, and no published rate-limit values.
- No dedicated batch API was mentioned on the models page; whether one exists was not confirmed.
- Model size, the main driver of the speed, is undisclosed.
