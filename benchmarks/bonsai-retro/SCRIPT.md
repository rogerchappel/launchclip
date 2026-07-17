# Bonsai 27B: The Phone-Sized Boss Fight

## Narration

Twenty-seven billion parameters. On a phone. That sounds like a cheat code. It isn't.

A normal 27.8-billion-parameter model in FP16 needs about 54 gigabytes just for its weights. PrismML's Bonsai 27B squeezes the 1-bit version into 3.9 gigabytes—small enough for a high-end iPhone.

Here is the trick. Instead of keeping a full-precision number for every weight, Bonsai turns most weights into a binary choice: minus one or plus one. The packed model averages about 1.125 bits per weight. Think of it as swapping a shelf of cartridges for one tiny ROM.

Checkpoint one: memory. Fifty-four gigabytes becomes 3.9. About fourteen times smaller.

Checkpoint two: quality. Across fifteen benchmarks, PrismML reports 76.1 for 1-bit Bonsai versus 85.0 for the full-precision base—roughly ninety percent of the score. The ternary version adds a zero state, grows to 5.9 gigabytes, and reaches 80.5.

Checkpoint three: speed. PrismML reports 11 tokens per second on an iPhone 17 Pro, up to 87 on an M5 Max, and 163 on an RTX 5090.

This is not just chat. The 27B model handles images, tools, reasoning, and long context. The weights are available under Apache 2.0, with local paths for Apple MLX and NVIDIA CUDA.

The real benchmark is not the biggest model. It is the most intelligence per gigabyte. Would you trade roughly ten percent of benchmark score for fourteen times less memory?

## Delivery

- Target: approximately 90 seconds at a measured, curious pace.
- Voice: confident technical narrator; warm, conversational, lightly playful; never breathless.
- Emphasize: “cheat code”, “3.9 gigabytes”, each “checkpoint”, “eleven tokens per second”, and the final question.
- Pronounce: FP16 as “F P sixteen”; MLX as “M L X”; CUDA as “coo-duh”; RTX as “R T X”.
- Treat every number as a reported PrismML result, not an independently reproduced benchmark.

## Evidence receipts

- PrismML announcement: https://prismml.com/news/prismml-releases-bonsai-27b
- PrismML technical launch post and 15-benchmark table: https://prismml.com/news/bonsai-27b
- Official demo, platform coverage, model formats, and Apache-2.0 license: https://github.com/PrismML-Eng/Bonsai-demo
