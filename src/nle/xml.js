// Minimal XML for the NLE writers: escaping, a small element builder, and a
// strict parser used to check that what we wrote is well-formed and to read it
// back for timing round-trips. No dependencies; it covers the XML subset the
// writers emit (prolog, DOCTYPE without an internal subset, elements,
// attributes, text, comments) and rejects anything malformed.

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 forbids most C0 control characters, even escaped.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** <name a="1">…</name> with attributes in the given order; undefined/null attributes are dropped. */
export function element(name, attributes = {}, children = null, indent = "") {
  const attrs = Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join("");
  if (children === null || children === undefined || (Array.isArray(children) && !children.length)) return `${indent}<${name}${attrs}/>`;
  if (typeof children === "string" || typeof children === "number") return `${indent}<${name}${attrs}>${escapeXml(children)}</${name}>`;
  return `${indent}<${name}${attrs}>\n${children.filter(Boolean).join("\n")}\n${indent}</${name}>`;
}

/** Text-only element shorthand. */
export function textElement(name, value, indent = "") {
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decode(text, at) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);?/g, (match, name) => {
    if (!match.endsWith(";")) throw new Error(`Unterminated entity ${match} at offset ${at}`);
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    if (!Object.hasOwn(ENTITIES, name)) throw new Error(`Unknown entity &${name}; at offset ${at}`);
    return ENTITIES[name];
  });
}

/**
 * Parse an XML document → {doctype, root} where every node is
 * {name, attributes, children, text}. Throws with an offset on malformed input
 * (mismatched or unclosed tags, duplicate attributes, stray "<" or "&").
 */
export function parseXml(source) {
  const text = String(source);
  let i = 0;
  let doctype = null;
  const stack = [];
  let root = null;
  const fail = (message) => { throw new Error(`XML not well-formed: ${message} at offset ${i}`); };
  const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
  const readName = () => {
    NAME.lastIndex = i;
    const match = NAME.exec(text);
    if (!match) fail("expected a name");
    i += match[0].length;
    return match[0];
  };
  const skipSpace = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  if (text.startsWith("﻿")) i = 1;
  while (i < text.length) {
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i);
      if (end < 0) fail("unterminated processing instruction");
      i = end + 2;
    } else if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      if (end < 0) fail("unterminated comment");
      i = end + 3;
    } else if (text.startsWith("<!DOCTYPE", i)) {
      if (root || stack.length) fail("DOCTYPE after the root element");
      const end = text.indexOf(">", i);
      if (end < 0) fail("unterminated DOCTYPE");
      if (text.slice(i, end).includes("[")) fail("internal DTD subsets are not supported");
      doctype = text.slice(i + 9, end).trim();
      i = end + 1;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i);
      if (end < 0 || !stack.length) fail("CDATA outside an element");
      stack.at(-1).text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith("</", i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (text[i] !== ">") fail(`expected > to close </${name}`);
      i += 1;
      const open = stack.pop();
      if (!open) fail(`unexpected </${name}>`);
      if (open.name !== name) fail(`</${name}> closes <${open.name}>`);
    } else if (text[i] === "<") {
      i += 1;
      const node = { name: readName(), attributes: {}, children: [], text: "" };
      for (;;) {
        const before = i;
        skipSpace();
        if (text.startsWith("/>", i)) { i += 2; attach(node); break; }
        if (text[i] === ">") { i += 1; attach(node); stack.push(node); break; }
        if (i === before) fail(`expected whitespace between attributes of <${node.name}>`);
        const key = readName();
        skipSpace();
        if (text[i] !== "=") fail(`attribute ${key} needs a value`);
        i += 1;
        skipSpace();
        const quote = text[i];
        if (quote !== "\"" && quote !== "'") fail(`attribute ${key} value must be quoted`);
        const end = text.indexOf(quote, i + 1);
        if (end < 0) fail(`unterminated attribute ${key}`);
        const raw = text.slice(i + 1, end);
        if (raw.includes("<")) fail(`"<" in attribute ${key}`);
        if (Object.hasOwn(node.attributes, key)) fail(`duplicate attribute ${key} on <${node.name}>`);
        node.attributes[key] = decode(raw, i);
        i = end + 1;
      }
    } else {
      const end = text.indexOf("<", i);
      const chunk = text.slice(i, end < 0 ? text.length : end);
      if (!stack.length) { if (chunk.trim()) fail("text outside the root element"); }
      else stack.at(-1).text += decode(chunk, i);
      i = end < 0 ? text.length : end;
    }
  }
  if (stack.length) fail(`<${stack.at(-1).name}> is never closed`);
  if (!root) fail("no root element");
  return { doctype, root };

  function attach(node) {
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) fail("more than one root element");
    else root = node;
  }
}

/** Depth-first list of descendants named `name` (or matching a predicate). */
export function findAll(node, name) {
  const match = typeof name === "function" ? name : (candidate) => candidate.name === name;
  const found = [];
  const visit = (current) => {
    for (const child of current.children) {
      if (match(child)) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
}

export function child(node, name) {
  return node?.children.find((entry) => entry.name === name) ?? null;
}

export function childText(node, name) {
  return child(node, name)?.text.trim() ?? null;
}
