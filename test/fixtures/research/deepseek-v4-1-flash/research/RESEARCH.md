# Research

8 claims: 5 verified, 2 contradicted, 1 unverified. 4 sources checked (4 primary), no web search key set.

## Flagged for the script

Cut, soften or source these before the script is final.

- **contradicted** [c005] On Terminal-Bench 4.0 DeepSeek-V4.1-Flash-1017 also beats Opus 5 with 51.8.  
  Hugging Face · deepseek-ai says 42.3 (DS-V4.1-Flash-1017; 51.8 is Opus 5) where the script says 51.8
- **contradicted** [c007] DeepSeek-V4.1-Flash-1017 was trained on 40 trillion tokens.  
  Hugging Face · deepseek-ai says 45T tokens where the script says 40 trillion tokens
- **unverified** [c008] DeepSeek's founder and CEO Liang Wenfeng has built the lab around releasing open weights.  
  no fetched source states this; soften it, or add the source with --url

## Verified

- [c001] DeepSeek released DeepSeek-V4.1-Flash-1017 on Hugging Face on October 17, 2026, and the weights are free to download under the MIT License.  
  primary: [deepseek-ai/DeepSeek-V4.1-Flash-1017 · model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017), confidence 0.95: “Hugging Face API: Model: deepseek-ai/DeepSeek-V4.1-Flash-1017; Created: 2026-10-17T02:40:38.000Z; Last modified: 2026-10-17T05:46:55.000Z; License: mit; Parame…”
- [c002] DeepSeek calls it a minor update to DeepSeek-V4.1-Flash, "delivering substantial improvements across reasoning, coding, agentic tasks, and visual benchmarks."  
  primary: [deepseek-ai/DeepSeek-V4.1-Flash-1017 · model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017), confidence 0.95: “**DeepSeek-V4.1-Flash-1017** is a minor update to [**DeepSeek-V4.1-Flash**](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash), delivering substantial imp…” → capture `hf-deepseek-v4-1-flash-1017`
- [c003] On Terminal-Bench 4.0 the new checkpoint scores 42.3, up from 31.2 for the previous Flash release.  
  primary: [deepseek-ai/DeepSeek-V4.1-Flash-1017 · model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017), confidence 0.78: “| Terminal-Bench 4.0 | 42.3 | 31.2 | 12.6 | 37.9 | 39.9 | 51.8 |” → capture `hf-deepseek-v4-1-flash-1017`
- [c004] On DeepSWE v1.1 DeepSeek-V4.1-Flash-1017 scores 77.0, ahead of GPT-5.6 Sol at 73.0.  
  primary: [deepseek-ai/DeepSeek-V4.1-Flash-1017 · model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017), confidence 0.84: “| DeepSWE v1.1 | 77.0 | 74.2 | 67.5 | 66.9 | 73.0 | 74.0 |” → capture `hf-deepseek-v4-1-flash-1017`
- [c006] It keeps a 1M tokens context window.  
  primary: [deepseek-ai/DeepSeek-V4.1-Flash-1017 · model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017), confidence 0.99: “| `context_window` | 1M tokens |” → capture `hf-deepseek-v4-1-flash-1017-2`

## Captures

- `hf-deepseek-v4-1-flash-1017` model-card: https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017 (10 beats)
- `hf-deepseek-v4-1-flash-1017-2` model-card: https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017 (5 beats)

## Data

- `data/hf-deepseek-v4-1-flash-1017-benchmark-1.json` benchmark: Introduction (11 rows, 11 chart views) from Hugging Face · deepseek-ai
- `data/hf-deepseek-v4-1-flash-1017-table-2.json` table: Recommended sampling parameters: (4 rows, 1 chart views) from Hugging Face · deepseek-ai
- `data/hf-deepseek-v4-1-flash-table-4.json` table: Recommended sampling parameters: (4 rows, 1 chart views) from Hugging Face · deepseek-ai
- `data/hf-deepseek-v4-1-flash-benchmark-1.json` benchmark: Base Model (28 rows, 9 chart views) from Hugging Face · deepseek-ai
- `data/hf-deepseek-v4-1-flash-benchmark-2.json` benchmark: Comparison with frontier models (Max reasoning effort) (21 rows, 10 chart views) from Hugging Face · deepseek-ai
- `data/hf-deepseek-v4-1-flash-benchmark-3.json` benchmark: Performance across agent scaffolds (DeepSWE v1.1 and Terminal-Bench 2.1, Max reasoning effort) (2 rows, 2 chart views) from Hugging Face · deepseek-ai

## Assets

- `wikimedia-commons-pdc-server-room` image, CC BY-SA 3.0: “PDC server room” by Esquilo, CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0), via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:PDC_server_room.jpg>
- `wikimedia-commons-server-room-22397102849` image, CC BY 2.0: “Server Room (22397102849)” by Carl Lender from Sunrise, USA, CC BY 2.0 (https://creativecommons.org/licenses/by/2.0), via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:Server_Room_(22397102849).jpg>
- `wikimedia-commons-139-server-room-01` image, CC BY-SA 3.0: “139 Server Room 01” by Indrajit Das, CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0), via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:139_Server_Room_01.jpg>
- `wikimedia-commons-a-stack-of-economist-papers` image, CC BY-SA 4.0: “A stack of Economist papers” by DonSpencer1, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:A_stack_of_Economist_papers.jpg>
- `wikimedia-commons-wright-js-a-stack-of-papers-scua-artists-books` image, CC BY-SA 4.0: “Wright JS A Stack of Papers SCUA artists books back” by ThaoTrin, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:Wright_JS_A_Stack_of_Papers_SCUA_artists_books_back.jpg>
- `wikimedia-commons-wright-js-a-stack-of-papers-scua-artists-books-2` image, CC BY-SA 4.0: “Wright JS A Stack of Papers SCUA artists books front” by ThaoTrin, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:Wright_JS_A_Stack_of_Papers_SCUA_artists_books_front.jpg>

## People

- Liang Wenfeng: entrepreneur, DeepSeek ([Q131847088](https://www.wikidata.org/wiki/Q131847088)); no image on the Wikidata item; no portrait
