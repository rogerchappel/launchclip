export const TEXT_CONTAINMENT_VERSION = "v6";

export function ensureTextContainment(html, shotId) {
  const source = String(html);
  if (source.includes(`data-launchclip-text-containment="${TEXT_CONTAINMENT_VERSION}"`)) return source;
  if (!/<\/template\s*>/i.test(source)) throw new Error(`Frame ${shotId} is missing the closing template required for text containment`);
  const withoutLegacyGuard = source.replace(/<script\b[^>]*data-launchclip-text-containment=["']v\d+["'][^>]*>[\s\S]*?<\/script>\s*/gi, "");
  const template = /<template\b[^>]*>/i.exec(withoutLegacyGuard);
  const close = /<\/template\s*>/i.exec(withoutLegacyGuard);
  const contentStart = template ? template.index + template[0].length : 0;
  const script = /<script\b/i.exec(withoutLegacyGuard.slice(contentStart, close.index));
  const insertion = script ? contentStart + script.index : close.index;
  return `${withoutLegacyGuard.slice(0, insertion)}${textContainmentScript(shotId)}\n${withoutLegacyGuard.slice(insertion)}`;
}

function textContainmentScript(shotId) {
  return `<script data-launchclip-text-containment="${TEXT_CONTAINMENT_VERSION}">
(() => {
  const script = document.currentScript;
  const scope = script && script.parentElement;
  const root = scope && scope.querySelector(${JSON.stringify(`[data-composition-id="${String(shotId)}"]`)});
  if (!root) return;
  const blockedTags = new Set(['SCRIPT','STYLE','TEMPLATE','SVG','PATH','DEFS','IMG','VIDEO','AUDIO','CANVAS']);
  const px = (value) => Number.parseFloat(value) || 0;
  const ownText = (element) => Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ').trim();
  const candidates = Array.from(root.querySelectorAll('*')).filter((element) =>
    !blockedTags.has(element.tagName) &&
    element.getAttribute('data-launchclip-text-fit') !== 'off' &&
    ownText(element)
  );
  const minimums = new WeakMap();
  const minSize = (element) => {
    if (!minimums.has(element)) {
      const initial = px(getComputedStyle(element).fontSize);
      const declared = px(element.getAttribute('data-launchclip-min-font-size'));
      minimums.set(element, declared > 0 ? Math.min(initial, declared) : Math.min(initial, Math.max(12, initial * .6)));
    }
    return minimums.get(element);
  };
  const maxLines = (element) => {
    const declared = Number.parseInt(element.getAttribute('data-launchclip-max-lines') || '', 10);
    if (Number.isInteger(declared) && declared > 0) return declared;
    return getComputedStyle(element).whiteSpace === 'nowrap' ? 1 : null;
  };
  const lineCount = (element) => {
    const style = getComputedStyle(element);
    const lineHeight = px(style.lineHeight) || px(style.fontSize) * 1.2;
    return lineHeight > 0 ? Math.max(1, Math.round(element.scrollHeight / lineHeight)) : 1;
  };
  const applyLinePolicy = (element) => {
    if (maxLines(element) === 1) {
      element.style.whiteSpace = 'nowrap';
      element.style.overflowWrap = 'normal';
      element.style.wordBreak = 'normal';
    }
  };
  const ownOverflow = (element) => {
    if (!element.clientWidth) return false;
    const style = getComputedStyle(element);
    const clips = style.overflowX === 'hidden' || style.overflowY === 'hidden' || style.overflowX === 'clip' || style.overflowY === 'clip';
    const declaresLines = element.hasAttribute('data-launchclip-max-lines');
    if (!clips && !declaresLines) return false;
    const lines = maxLines(element);
    return element.scrollWidth > element.clientWidth + 1 ||
      (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1) ||
      (lines != null && lineCount(element) > lines);
  };
  const mark = (element) => {
    element.dataset.launchclipFitText = 'true';
  };
  const shrinkOne = (element) => {
    const size = px(getComputedStyle(element).fontSize);
    const minimum = minSize(element);
    if (!(size > minimum + .25)) return false;
    element.style.fontSize = Math.max(minimum, size - 1) + 'px';
    mark(element);
    return true;
  };
  const fitOwnBox = (element) => {
    let attempts = 0;
    while (ownOverflow(element) && attempts < 96 && shrinkOne(element)) attempts += 1;
  };
  const isVisualContainer = (element) => {
    if (!element || element === root || !element.clientWidth || !element.clientHeight) return false;
    const style = getComputedStyle(element);
    const hasPaint = style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' ||
      px(style.borderTopWidth) + px(style.borderRightWidth) + px(style.borderBottomWidth) + px(style.borderLeftWidth) > 0;
    return hasPaint || style.overflowX === 'hidden' || style.overflowY === 'hidden' || style.overflowX === 'clip' || style.overflowY === 'clip';
  };
  const contentBox = (container) => {
    const rect = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    const declared = px(container.getAttribute('data-launchclip-safe-padding'));
    const safe = declared > 0 ? declared : 8;
    return {
      left: rect.left + px(style.borderLeftWidth) + Math.max(px(style.paddingLeft), safe),
      right: rect.right - px(style.borderRightWidth) - Math.max(px(style.paddingRight), safe),
      top: rect.top + px(style.borderTopWidth) + Math.max(px(style.paddingTop), safe),
      bottom: rect.bottom - px(style.borderBottomWidth) - Math.max(px(style.paddingBottom), safe)
    };
  };
  const outside = (element, box) => {
    const rect = element.getBoundingClientRect();
    return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
  };
  const overlaps = (left, right) => {
    if (left === right || left.contains(right) || right.contains(left)) return false;
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return width > 2 && height > 2;
  };
  const groups = new Map();
  for (const element of candidates) {
    applyLinePolicy(element);
    const container = element.parentElement;
    if (!isVisualContainer(container) || !container.hasAttribute('data-launchclip-safe-padding')) continue;
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push(element);
  }
  for (let pass = 0; pass < 6; pass += 1) {
    for (const element of candidates) fitOwnBox(element);
    for (const [container, elements] of groups) {
      const box = contentBox(container);
      let attempts = 0;
      while (elements.some((element) => outside(element, box)) && attempts < 96) {
        let changed = false;
        for (const element of elements) if (outside(element, box)) changed = shrinkOne(element) || changed;
        if (!changed) break;
        attempts += 1;
      }
      attempts = 0;
      while (elements.some((element, index) => elements.slice(index + 1).some((other) => overlaps(element, other))) && attempts < 96) {
        let changed = false;
        for (let index = 0; index < elements.length; index += 1) {
          for (const other of elements.slice(index + 1)) {
            if (!overlaps(elements[index], other)) continue;
            changed = shrinkOne(elements[index]) || changed;
            changed = shrinkOne(other) || changed;
          }
        }
        if (!changed) break;
        attempts += 1;
      }
    }
  }
  const issues = [];
  const identity = (element) => element.id ? '#' + element.id : element.classList.length ? '.' + Array.from(element.classList).join('.') : element.tagName.toLowerCase();
  for (const element of candidates) {
    if (ownOverflow(element)) issues.push({ kind: 'overflow-or-lines', element: identity(element) });
  }
  for (const [container, elements] of groups) {
    const box = contentBox(container);
    for (const element of elements) if (outside(element, box)) issues.push({ kind: 'unsafe-padding', element: identity(element), container: identity(container) });
    for (let index = 0; index < elements.length; index += 1) {
      for (const other of elements.slice(index + 1)) if (overlaps(elements[index], other)) issues.push({ kind: 'text-collision', element: identity(elements[index]), other: identity(other), container: identity(container) });
    }
  }
  const adjusted = candidates.filter((element) => element.dataset.launchclipFitText === 'true').length;
  root.dataset.launchclipTextContainment = '${TEXT_CONTAINMENT_VERSION}';
  root.dataset.launchclipTextAdjusted = String(adjusted);
  root.dataset.launchclipTextUnresolved = String(issues.length);
  window.__launchclipTextContainment = window.__launchclipTextContainment || [];
  window.__launchclipTextContainment.push({ shotId: ${JSON.stringify(String(shotId))}, adjusted, unresolved: issues });
  const issueSummary = issues.map((issue) => issue.kind + '@' + issue.element + (issue.other ? '~' + issue.other : '') + (issue.container ? ' in ' + issue.container : '')).join(' | ');
  if (issues.length) console.warn('[LaunchClip text containment] ${String(shotId)} has ' + issues.length + ' unresolved layout issue(s): ' + issueSummary);
})();
</script>`;
}
