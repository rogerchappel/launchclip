# "JEV" scoring model: availability, licence, speed and cost (as of 22 November 2026)

Research date: 2026-11-22. Source quality note: TypeSafe's own docs (docs.typesafe.ai) were read directly for the API shape, primitives, request rules, legal index and known limitations. Pricing, token limits, rate limits and the 1.14 release details were NOT found on the official pages I could reach; they come from third-party write-ups that attribute them to TypeSafe docs. They are marked "unverified against primary" below. The Master Customer Agreement itself was not read.

## Which model is "JEV"?

### Takeaway
"JEV" is almost certainly **Jev by TypeSafe AI**, a hosted, non-generative "System One" decision model launched 15 September 2026 that returns typed answers and probabilities (scores, yes/no, choices, bounding boxes) instead of text. Confidence: high (about 95%); every part of the dictated description matches and no competing model with a similar name surfaced.

### Cited Findings
- Jev is TypeSafe's flagship model and "the first System One model"; it returns structured answers rather than generated text — [TypeSafe docs, introduction](https://docs.typesafe.ai)
- Launched 15 September 2026; outputs labels and probabilities, no text at all — [Layer3 Labs guide](https://www.layer3labs.io/guides/jev-limits) (third party)
- You provide context and questions; it returns categories, scores and probabilities; labels are specified at request time, so no per-task fine-tune — [Parallel, "Testing out Jev"](https://parallel.ai/blog/testing-jev.md)
- "Any mix of question types can go in one request. Each question is evaluated in parallel and in isolation against the same state"; "Adding questions barely changes the response time" — [TypeSafe docs, introduction](https://docs.typesafe.ai)
- Searches for "GEV", "Jive", "ZEV", "Jeev" as AI scoring models returned only Jev results — [Qdrant](https://qdrant.tech/blog/jevjitsu/index.md), [Elastic](https://www.elastic.co/search-labs/blog/ecommerce-search-reranking-llm-alternative-jev) (search result listing only; Elastic page not read)
- Latest version is Jev 1.14, released 14 October 2026; 1.13 was the launch-era version (`jev-1.13-20260917` on OpenRouter) — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained) (attributes to TypeSafe changelog; unverified against primary), [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/)

### Inferences
- "Really fast at scoring thousands of things at a time" maps onto the parallel-questions design (many typed questions per request, evaluated in one pass) plus high request concurrency.
- Capitalised "JEV" also appears as the name of an unaffiliated open-weights clone (`autotrust/JEV`); the dictated name could refer to either, but the description came from the TypeSafe product's marketing.

### Gaps
- Architecture and parameter count of Jev are not published in any source read.
- TypeSafe's own launch post and changelog were not read directly.

## Is it open weights, API-only, or both? Licence, commercial use, redistribution

### Takeaway
The real Jev is **API-only and proprietary**: no weights, no self-hosting, so it cannot be bundled into or redistributed with an open-source project; an open-source tool can only call it with the user's own API key. Open-weights look-alikes exist under Apache-2.0 and MIT and are the only route to a fully local scorer.

### Cited Findings
- TypeSafe has not released weights or training details; "OpenJev" is a collective term for independent reproductions, not an official release — [Classmethod](https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/)
- TypeSafe open-sources SDKs, agent skill, adapter, eval code and n8n node under MIT or Apache-2.0, but not the model, weights or training code — [jev-ai.org via search summary](https://jev-ai.org/blog/jev-github/) (SEO-style third party, page not read; unverified)
- Governing documents are the Master Customer Agreement, Data Processing Agreement and Privacy Policy; the Privacy Policy is described as including "our commitment not to train models on user data"; zero data retention is available to enterprise customers on request — [TypeSafe docs, legal](https://docs.typesafe.ai/legal.md)
- One site claims MCA clause 2.3(b) forbids using the service or its outputs to develop a similar product — [jev101.org via search summary](https://jev101.org/self-hosted-jev) (single secondary source, page not read; UNVERIFIED)
- Not available on Amazon Bedrock, Google Vertex AI or Azure Foundry — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained) (attributes to TypeSafe help center)
- Available through routers: OpenRouter (`typesafe/jev-1.13`) and Requesty (`typesafe/jev-latest`, `typesafe/jev-1.14.0`) — [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/), [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained)
- Sign-up open to everyone since 27 September 2026 (search summary of third-party guides); contradicted by a guide that still describes an early-access waitlist with no GA date — [developersdigest via search](https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026); contradicted by [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits)
- Open clone `autotrust/JEV-9B`: Apache-2.0 weights, distilled from Jev 1.13's published output distributions, "not affiliated with, endorsed by, or a product of TypeSafe AI, and shares no weights or code with it" — [Hugging Face model card](https://huggingface.co/autotrust/JEV)
- Open clone `daseinlabs/open-jev`: MIT code; uses Gemma 3 4B, which requires accepting the Gemma licence on Hugging Face — [GitHub](https://github.com/daseinlabs/open-jev)
- Open clone `rorshopping/jev-on-a-laptop`: MIT code and docs; engine is Apache-2.0 and is cloned at setup, not redistributed — [GitHub](https://github.com/rorshopping/jev-on-a-laptop)
- The Classmethod survey lists seven independent implementations and does not state licences for them — [Classmethod](https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/)

### Inferences
- For an open-source, local-first tool, the clean pattern is an optional BYO-key provider for hosted Jev plus a local backend built on a permissively licensed base model (Qwen-based clones are Apache-2.0; the Gemma-based one inherits Gemma terms, which are not a standard OSI licence).
- A model distilled from Jev's outputs (autotrust/JEV) carries legal uncertainty if the reported anti-distillation clause is real: the Apache-2.0 tag covers the weights' copyright, not whether the distiller's use of the API complied with TypeSafe's terms. Treat as a risk to check, not a settled fact.
- Commercial use of the hosted API is the normal case under a paid customer agreement, but I did not read the clause that says so.

### Gaps
- The Master Customer Agreement text was not read: commercial-use wording, output-use restrictions and benchmarking clauses are unconfirmed. Read https://typesafe.ai/legal/mca before relying on any of this.
- Data retention periods are in the DPA and were not read.
- Whether access is fully general availability or still gated: sources conflict.

## Model sizes/variants, hardware needs, local use on Apple Silicon

### Takeaway
Hosted Jev has no local form at all. Local use on a Mac means a clone: two MLX-native projects are measured on M5 Macs (a 16 GB MacBook Air is enough for the small ones), while the closest accuracy match to Jev (autotrust/JEV-9B) ships as safetensors for vLLM/transformers and is benchmarked only on a data-centre NVIDIA GPU.

### Cited Findings
- Hosted model ids: `jev-latest` (request), `jev-1.13.0` (returned in quickstart example) — [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart.md); `jev-1.14.0` pinned id on Requesty — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained)
- `daseinlabs/open-jev`: one-pass option scoring with local Gemma 3 4B; MLX is the default backend on Apple silicon (`make setup`, `make serve`); about 8 GB memory at 16-bit for base scoring; on an M5 Pro 64 GB, 202-token context with 8 options: median 0.17 s with context cached, 0.68 s uncached; about 90 ms per server request cited; 139 stars — [GitHub](https://github.com/daseinlabs/open-jev)
- Same repo's caveat: zero-shot probabilities are "softmaxed likelihoods, not calibrated judgements" — [GitHub](https://github.com/daseinlabs/open-jev)
- `rorshopping/jev-on-a-laptop`: MLX (mlx-lm) on a 16 GB M5 MacBook Air with 4-bit Qwen2.5-1.5B, Qwen2.5-7B and Qwen3-8B; 28-field preset in 0.41 s (1.5B), 1.52 s (7B), 2.03 s (8B), about 7 to 8x faster than naive JSON generation; per-case latency 147 ms / 611 ms / 646 ms — [GitHub](https://github.com/rorshopping/jev-on-a-laptop)
- Same repo's accuracy: on 343 like-for-like question pairs from TypeSafe's public set, Jev agreed with the reference 86.6%, local Qwen2.5-7B 73.8%; the 1.5B is "suited to demos only"; the 7B was over 0.90 confident on 13 of its 20 wrong fields — [GitHub](https://github.com/rorshopping/jev-on-a-laptop)
- `autotrust/JEV-9B`: base `Qwen/Qwen3.5-9B` plus a 40.2M-parameter adapter, about 18 GB download (54 GB for JEV-27B); safetensors only (no GGUF, MLX or ONNX listed); recommended runtime vLLM with LoRA, or `transformers` + `peft`; handles images; no minimum hardware stated — [Hugging Face model card](https://huggingface.co/autotrust/JEV)
- autotrust/JEV-9B fidelity to the teacher: `choice` top-1 agreement with Jev 90.2%, `noul` AUROC 0.994, `score` MAE 0.103; 11.5% of 16-option answers change with option order alone (teacher 7.0%) — [Hugging Face model card](https://huggingface.co/autotrust/JEV)
- `TheoLeeCJ/openjev`: reads scores directly from stock Qwen3.5-4B with no training; a browser demo at openjev.com defaults to a quantized MiniCPM5 2B with a 1.56 GB download — [Classmethod](https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/)
- The Classmethod author found no open reproduction of Jev's calibration-trained layer; recommends starting with "change only the readout" on a stock model and escalating only where accuracy falls short — [Classmethod](https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/)

### Inferences
- The underlying trick (prefill prompt once, read next-token logits over a fixed option set, batch one row per question) works with any local causal LM that exposes logits, so MLX and transformers-on-MPS are natural fits. llama.cpp/GGUF exposes logits too, but no source read shows a Jev clone using it.
- autotrust/JEV-9B at BF16 (about 18 GB) should fit a 32 GB+ Apple Silicon Mac via transformers on MPS, but nobody in the sources has measured it there; an MLX conversion is not listed.

### Gaps
- No Core ML, ONNX or GGUF build of any Jev clone was found.
- No Mac measurements for autotrust/JEV; no independent verification of the clone repos' own numbers.
- Jev's parameter count and serving hardware are unpublished.

## API details: endpoint shape, batch support, pricing, rate limits

### Takeaway
One REST endpoint, `POST https://api.typesafe.ai/v1/systemone`, takes a `state` plus a map of named typed questions and returns typed answers with probabilities; price is reported as $0.042 per million input tokens with output free. There is no documented batch endpoint (batching is done by packing questions into a request and running requests concurrently) and no reliably published rate limit.

### Cited Findings
- Endpoint `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <API_KEY>`; body fields `model`, `state`, `questions` (each with `type`, `instructions`, `criteria`) — [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart.md)
- SDKs: Python `typesafe-sdk` (Python 3.10+), JavaScript/TypeScript `@typesafe-ai/sdk` (Node 20+); key read from `TYPESAFE_API_KEY`; OpenAPI spec at api.typesafe.ai/openapi.json — [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart.md), [docs index](https://docs.typesafe.ai/llms.txt)
- Four question types: Choice (`choice`, `probabilities`, `confidence`), Score (`score`, `probabilities`, `confidence`), Noul (yes-probability 0 to 1), Box (bounding box in an image) — [TypeSafe docs, introduction](https://docs.typesafe.ai)
- Price $0.042 per million input tokens, output free; no free tier or trial credits — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained) (attributes to official docs), [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits); no pricing page exists in the official docs index — [docs index](https://docs.typesafe.ai/llms.txt)
- Requesty resells at $0.0441 per million input tokens (5% markup) through `POST https://router.requesty.ai/v1/systemone`, text only — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained)
- Rate limits: official docs only say `429` means the rate limit was exceeded and `529` means overloaded, both to be retried with exponential backoff; SDKs retry automatically — [TypeSafe request rules](https://docs.typesafe.ai/api/errors.md)
- Third-party rate-limit numbers conflict: "100,000 tokens/second and 80 requests/second", "250,000 tokens/s and 1,200 requests/minute", and "not published"; one summary says limits are per organisation and shown in the developer console — search summary across [developersdigest](https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026), [innfactory](https://innfactory.ai/en/ai-models/typesafe-jev/), [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits) (UNVERIFIED; treat none as authoritative)
- No batch endpoint or batch pricing appears in the official docs index; the documented pattern is many questions per request ("Parallel questions" cookbook, "Speculative fan-out" pattern) — [docs index](https://docs.typesafe.ai/llms.txt)
- Request body up to 32 MiB; gzip or zstd compression supported — [TypeSafe request rules](https://docs.typesafe.ai/api/errors.md)

### Inferences
- Scoring N items against one rubric is N requests (each item is its own `state`), or one request with N items in the state and N questions; the latter is capped by the context limit and exposed to the documented "large state with irrelevant detail" accuracy drop, so per-item requests run concurrently are the safer design.
- The quickstart response shows `output_tokens: 73` in `usage` even though output is reported as free; billing appears to count input tokens only.

### Gaps
- Official pricing page and official rate-limit numbers not found.
- No asynchronous/offline batch API found; cannot confirm one does not exist behind the console.

## Throughput, latency and cost per thousand items

### Takeaway
Independent measurements put hosted Jev at roughly 170 to 330 ms per request regardless of question count, and about $0.02 to $0.04 per thousand judgments for short-to-article-length inputs; nobody has published a sustained items-per-second figure for the hosted API. Local clones reach about 340 to 400 decisions per second on a data-centre GPU and single-digit decisions per second on a laptop.

### Cited Findings
- Median latency 171 ms (yes/no on short passages) and 168 ms (score over a full article), versus 1,662 ms and 2,902 ms for an LLM judge — [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/)
- Cost $0.021 per 1,000 faithfulness judgments and $0.043 per 1,000 article-summary scores, versus $0.114 and $0.261 for the LLM judge — [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/)
- Round trip 0.245 to 0.327 s for requests carrying 21 questions via OpenRouter, network included; about $0.002 total for all the author's tests — [Classmethod](https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/)
- Hosted Jev 1.13 measured by third parties at 238 to 301 ms per decision — [autotrust/JEV model card](https://huggingface.co/autotrust/JEV)
- As a search reranker, Jev "adds half a second to two seconds per query, depending on how many categories it reads" — [Qdrant](https://qdrant.tech/blog/jevjitsu/index.md)
- Worked example: 100,000 requests of 1,000 input tokens costs about $4.20 — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained), [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits)
- Real-world average request on one router was 2,961 tokens at a blended $0.04 per million tokens — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained)
- Vendor claim: up to 200x faster and 400x cheaper than comparable LLMs on classification — [search summary of launch coverage](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/) (vendor arithmetic; independent tests above show roughly 10 to 17x faster and 5 to 6x cheaper than the specific judge tested)
- Parallel found Jev had a "materially higher cost per document" than its in-house rerankers; headline comparisons are against autoregressive LLMs, and "specialized classifiers will often outperform Jev on cost and speed" — [Parallel](https://parallel.ai/blog/testing-jev.md)
- Local, autotrust/JEV-9B on one NVIDIA B200: single decision median about 90 ms; batched 2.5 ms per decision (about 400/s); 14,400 decisions in 42 s (about 340/s); 150 to 205 req/s over HTTP at 64 to 256 concurrent clients — [Hugging Face model card](https://huggingface.co/autotrust/JEV)
- Local, RTX 3090 with stock Qwen3.5-4B: 21 binary questions in 1.023 s by reading scores directly versus 5.332 s generating JSON; batching shared state cut 777 judgments from 333.1 s to 38.8 s — [Classmethod](https://dev.classmethod.jp/en/articles/openjev-non-generative-ai-alternatives/)
- Local, Mac figures are in the Apple Silicon section above (0.17 s per 8-option decision on M5 Pro; 0.41 s for 28 fields with a 1.5B model on a 16 GB M5 Air) — [daseinlabs](https://github.com/daseinlabs/open-jev), [rorshopping](https://github.com/rorshopping/jev-on-a-laptop)

### Inferences
- Cost per thousand items is simply tokens-per-item times $0.042 per million: about $0.004 at 100 tokens, $0.021 at 500, $0.042 at 1,000, $0.13 at 3,000 (my arithmetic from the reported rate). Scoring 10,000 short content items costs well under a dollar.
- Hosted throughput is bounded by concurrency and the account's rate limit, not per-request latency: at about 0.2 s per request, 50 concurrent connections would be roughly 250 items per second if the rate limit allows it. This is an estimate, not a measurement.
- On a Mac, a clone doing 5 to 25 decisions per second scores thousands of items in minutes, at zero marginal cost but with weaker, uncalibrated accuracy.

### Gaps
- No published or community sustained-throughput benchmark (items per second at scale) for hosted Jev.
- Latency for image inputs and for long-context requests not found.
- Latency numbers are for 1.13; nothing found for 1.14.

## Input limits, modalities and output format

### Takeaway
Input is a "state" of text, JSON or (from 1.14, direct API only) PNG/JPEG images; no audio or video. Reported default limits are 64k tokens per request and 32k per question. Output is always structured JSON: a label, a score or a probability, with per-option probabilities and a confidence for some types, and never a written rationale.

### Cited Findings
- State can be "text, JSON, or images"; answers are "typed answers + probabilities + confidence (some types)" — [TypeSafe docs, introduction](https://docs.typesafe.ai)
- Images can be sent in the state, inside instructions and as criteria — [docs index, Images page](https://docs.typesafe.ai/llms.txt)
- Image input (PNG or JPEG) and the Box type arrived in Jev 1.14; through Requesty, Jev is text only — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained) (unverified against changelog); contradicted by an older guide saying text only, no images — [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits) (appears stale, predates 1.14)
- Default limits 64k tokens per request and 32k per question; a long-context header raises both to 262k — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained) (unattributed; UNVERIFIED); an older guide says "roughly 32,000 tokens" per call — [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits). The official request-rules page confirms a `max_tokens_exceeded` 400 error but states no token numbers — [TypeSafe request rules](https://docs.typesafe.ai/api/errors.md)
- Choice takes up to 255 options; Score takes 2 to 10 described levels; Noul has no separate confidence field — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained) (attributes to TypeSafe docs)
- No stated cap on the number of questions per request — [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits)
- Example Score response: `score: 0.67`, `confidence: 0.5`, a `legend` mapping level index to text, and `probabilities` per level; example Noul response: `noul: 0.99` — [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart.md)
- Body limit 32 MiB; at most 64 nesting levels in `state`, `instructions` and `criteria` — [TypeSafe request rules](https://docs.typesafe.ai/api/errors.md)
- No streaming and no audio — [Layer3 Labs](https://www.layer3labs.io/guides/jev-limits)

### Inferences
- For a video/content tool, Jev can score scripts, titles, hooks, captions, transcripts and single still frames or thumbnails; video and audio must first be reduced to transcripts and sampled frames.
- The Score value in the quickstart looks normalised to 0 to 1 across the levels rather than returned as a raw level index; the per-level `probabilities` are the safer thing to consume.

### Gaps
- Per-image size, count and token-cost rules not read (the Images page was not fetched).
- Official token limits and the long-context header are unconfirmed.
- "Better multilingual support" in 1.14 is mentioned without detail; non-English quality is unquantified.

## Known limitations, failure modes and criticisms

### Takeaway
Jev is strong and cheap for closed, written-down rubrics on short evidence, and weaker for open-ended quality judgments over long text, large label sets, counting, dates and anything adversarial; it gives no explanation, and its launch claims were criticised as vendor arithmetic against an unfair baseline. For "is this content good" style scoring, the rubric must be spelled out and thresholds validated on your own labelled examples.

### Cited Findings
- Vendor-documented failure modes: literal reading of wording; unreliable counting; score outputs "weakly calibrated numerically" (use for thresholds, not magnitudes); unreliable date/time comparison; multi-hop and double-negative questions; accuracy falls as irrelevant state grows; injected instructions in state can shift answers; contradictory instructions/criteria; bias toward the first Choice option; not for text generation — [TypeSafe docs, model jaggedness](https://docs.typesafe.ai/model-jaggedness.md)
- Summary scoring against expert ratings (Spearman): coherence Jev 0.42 vs LLM judge 0.44; consistency Jev 0.47 vs LLM judge 0.72; long-context consistency checks were notably worse than the LLM judge — [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/)
- Closed-rubric faithfulness: Jev 84/88 (95.5%) vs LLM judge 83/88, Brier 0.043 vs 0.054 — [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/)
- No written explanation; criteria must be expressible in writing; "calibration varies by task and model, so thresholds must be measured on your own labels" — [OpenRouter](https://openrouter.ai/blog/tutorials/jev-vs-llm-as-a-judge/)
- Large label sets and out-of-distribution tasks (query freshness) lost to in-house trained classifiers — [Parallel](https://parallel.ai/blog/testing-jev.md)
- A 0.91-confidence wrong category filter hurt an ambiguous query; negations such as "not Nike" could not be expressed as a category — [Qdrant](https://qdrant.tech/blog/jevjitsu/index.md)
- Jev did beat two local cross-encoders on reranking lift (nDCG@10 +0.0665 for Jev Score vs +0.0313 for ms-marco-MiniLM-L-6-v2 on 100 NFCorpus queries) — [Qdrant](https://qdrant.tech/blog/jevjitsu/index.md)
- TypeSafe's own published evals put Jev at 67.8% mean accuracy against a frontier-model consensus — [rorshopping/jev-on-a-laptop](https://github.com/rorshopping/jev-on-a-laptop) (secondary citation of vendor evals)
- Community criticism: a Hacker News thread of about 390 comments focused on the comparison pitting a classifier-shaped call against LLMs doing full chain-of-thought; critics said every headline number was the vendor's own arithmetic; a LocalLLaMA post claimed prior open-source art for the architecture — [search summary of traictory.com and others](https://traictory.com/news/2026-09-25-jev-typesafe-marketing-backlash) (secondary, pages not read; UNVERIFIED)
- An "eight days of independent tests" write-up is titled "Level With Mid-Price LLMs, Behind the Frontier" — [AI in Plain English](https://ai.plainenglish.io/jev-after-eight-days-of-independent-tests-level-with-mid-price-llms-behind-the-frontier-05daa8f21e2e) (title only; page returned 403)
- Vendor lock-in facts: single vendor, not on the major clouds, `jev-latest` alias can change underneath you — [Requesty](https://www.requesty.ai/blog/typesafe-jev-explained)
- Clones inherit the teacher's errors and add their own; raw-logit clones are uncalibrated and overconfident when wrong — [autotrust/JEV](https://huggingface.co/autotrust/JEV), [rorshopping](https://github.com/rorshopping/jev-on-a-laptop)

### Inferences
- Subjective content scoring ("will this hook perform", "is this script engaging") is closer to the open-rubric case where Jev trailed an LLM judge, so expect it to be useful as a cheap first-pass filter or ranker over many candidates, with a generative model or a human on the short list.
- Because scores are weakly calibrated as magnitudes and option order matters, robust use means thresholds or rankings, shuffled option order, and pinned model versions rather than `jev-latest`.
- Content pulled from the web and placed in `state` is an injection surface, since Jev does not treat state as hostile.

### Gaps
- No independent benchmark found on creative/content-quality scoring specifically.
- The Hacker News and r/LocalLLaMA threads were not read directly.
- No independent evaluation of Jev 1.14 or of image/Box accuracy found.
