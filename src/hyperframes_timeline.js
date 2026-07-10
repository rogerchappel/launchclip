export function ensureTimelineRegistration(html, compositionId) {
  if (new RegExp(`window\\.__timelines\\s*\\[\\s*["']${escapeRegExp(compositionId)}["']\\s*\\]`).test(html)) return html;
  const variables = [...String(html).matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/g)].map((match) => match[1]);
  const timeline = variables.at(-1);
  if (!timeline) return html;
  const statements = `window.__timelines = window.__timelines || {};\n${timeline}.pause(0);\nwindow.__timelines[${JSON.stringify(compositionId)}] = ${timeline};`;
  const closures = [...String(html).matchAll(/\}\s*\(\s*\)\s*\)\s*;|\}\s*\)\s*\(\s*\)\s*;/g)];
  if (closures.length) {
    const closure = closures.at(-1);
    return `${html.slice(0, closure.index)}${statements}\n${html.slice(closure.index)}`;
  }
  const registration = `<script>\n${statements}\n</script>`;
  if (/<\/template>/i.test(html)) return html.replace(/<\/template>/i, `${registration}\n</template>`);
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${registration}\n</body>`) : `${html}\n${registration}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
