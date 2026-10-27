// Real BPE tokens for the tokenizer module (kit/core/catalog-i-tokenizer.mjs).
// kit/core stays import-free, so the split is precomputed here with
// gpt-tokenizer (an optional dependency) and written into the scene's
// params: {text, tokens, encoding}.
//
//   node src/tokenizer.js "Terra continues to advance the frontier" [--encoding cl100k_base]
//     prints the params fragment as JSON.

import { pathToFileURL } from "node:url";

export const TOKENIZER_ENCODINGS = Object.freeze(["o200k_base", "cl100k_base"]);

/** The BPE split of `text` as token strings (joining back to `text` exactly). */
export async function tokenize(text, { encoding = "o200k_base" } = {}) {
  if (typeof text !== "string" || !text) throw new Error("tokenize: text must be a non-empty string");
  if (!TOKENIZER_ENCODINGS.includes(encoding)) throw new Error(`tokenize: encoding must be one of ${TOKENIZER_ENCODINGS.join(", ")}`);
  let bpe;
  try {
    bpe = await import(`gpt-tokenizer/encoding/${encoding}`);
  } catch (error) {
    throw new Error(`tokenize: gpt-tokenizer is not installed (npm install gpt-tokenizer); ${error.message}`);
  }
  const tokens = bpe.encode(text).map((id) => bpe.decode([id]));
  // A token can split a multi-byte character; then the pieces do not join back.
  if (tokens.join("") !== text) throw new Error("tokenize: the text has characters that split across tokens; use plain text");
  return tokens;
}

/** The tokenizer module's params fragment for `text`: {text, tokens, encoding}. */
export async function tokenizerParams(text, { encoding = "o200k_base" } = {}) {
  return { text, tokens: await tokenize(text, { encoding }), encoding };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--encoding");
  const encoding = at >= 0 ? args.splice(at, 2)[1] : "o200k_base";
  tokenizerParams(args.join(" "), { encoding })
    .then((params) => process.stdout.write(`${JSON.stringify(params, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
