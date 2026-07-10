export function ensureTimelineRegistration(html, compositionId) {
  const source = stripLegacyDuplicateRegistration(String(html), compositionId);
  if (hasTimelineRegistration(source, compositionId)) return source;
  const variables = [...source.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/g)];
  const variable = variables.at(-1);
  const timeline = variable?.[1];
  if (!timeline) return source;
  const statements = `window.__timelines = window.__timelines || {};\n${timeline}.pause(0);\nwindow.__timelines[${JSON.stringify(compositionId)}] = ${timeline};`;
  const scriptOpen = source.lastIndexOf("<script", variable.index);
  const scriptBodyStart = scriptOpen >= 0 ? source.indexOf(">", scriptOpen) + 1 : -1;
  const scriptClose = scriptBodyStart > 0 ? source.indexOf("</script>", variable.index) : -1;
  if (scriptBodyStart > 0 && scriptClose > variable.index) {
    const body = source.slice(scriptBodyStart, scriptClose);
    const closures = [...body.matchAll(/\}\s*\(\s*\)\s*\)\s*;|\}\s*\)\s*\(\s*\)\s*;/g)];
    const insertion = closures.length ? scriptBodyStart + closures.at(-1).index : scriptClose;
    return `${source.slice(0, insertion)}${statements}\n${source.slice(insertion)}`;
  }
  const registration = `<script>\n${statements}\n</script>`;
  if (/<\/template>/i.test(source)) return source.replace(/<\/template>/i, `${registration}\n</template>`);
  return /<\/body>/i.test(source) ? source.replace(/<\/body>/i, `${registration}\n</body>`) : `${source}\n${registration}`;
}

function stripLegacyDuplicateRegistration(source, compositionId) {
  if (!hasAliasedRegistration(source, compositionId)) return source;
  const generated = new RegExp(`<script>\\s*window\\.__timelines\\s*=\\s*window\\.__timelines\\s*\\|\\|\\s*\\{\\}\\s*;\\s*([a-zA-Z_$][\\w$]*)\\.pause\\(0\\)\\s*;\\s*window\\.__timelines\\s*\\[\\s*["']${escapeRegExp(compositionId)}["']\\s*\\]\\s*=\\s*\\1\\s*;\\s*<\\/script>\\s*`, "g");
  return source.replace(generated, "");
}

export function hasTimelineRegistration(html, compositionId) {
  const source = String(html ?? "");
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  return (scripts.length ? scripts : [source]).some((script) => {
    if (new RegExp(`window\\.__timelines\\s*\\[\\s*["']${escapeRegExp(compositionId)}["']\\s*\\]`).test(script)) return true;
    const aliases = [...script.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(["'])([^"']+)\2/g)]
      .filter((match) => match[3] === compositionId)
      .map((match) => match[1]);
    return aliases.some((alias) => new RegExp(`window\\.__timelines\\s*\\[\\s*${escapeRegExp(alias)}\\s*\\]`).test(script));
  });
}

function hasAliasedRegistration(source, compositionId) {
  const scripts = [...String(source).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  return scripts.some((script) => {
    const aliases = [...script.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(["'])([^"']+)\2/g)]
      .filter((match) => match[3] === compositionId)
      .map((match) => match[1]);
    return aliases.some((alias) => new RegExp(`window\\.__timelines\\s*\\[\\s*${escapeRegExp(alias)}\\s*\\]`).test(script));
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
