const TEXT_CONTAINMENT_VERSION = "v1";

export function ensureTextContainment(html, shotId) {
  const source = String(html);
  if (source.includes(`data-launchclip-text-containment="${TEXT_CONTAINMENT_VERSION}"`)) return source;
  if (!/<\/template\s*>/i.test(source)) throw new Error(`Frame ${shotId} is missing the closing template required for text containment`);
  const script = textContainmentScript(shotId);
  return source.replace(/<\/template\s*>/i, `${script}\n</template>`);
}

function textContainmentScript(shotId) {
  return `<script data-launchclip-text-containment="${TEXT_CONTAINMENT_VERSION}">
(() => {
  const script = document.currentScript;
  const scope = script && script.parentElement;
  const root = scope && scope.querySelector(${JSON.stringify(`[data-composition-id="${String(shotId)}"]`)});
  if (!root) return;
  const blockedTags = new Set(['SCRIPT','STYLE','TEMPLATE','SVG','PATH','DEFS','IMG','VIDEO','AUDIO','CANVAS']);
  const hasOwnText = (element) => Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const candidates = Array.from(root.querySelectorAll('*')).filter((element) =>
    !blockedTags.has(element.tagName) &&
    element.getAttribute('data-launchclip-text-fit') !== 'off' &&
    hasOwnText(element)
  );
  const px = (value) => Number.parseFloat(value) || 0;
  const minimums = new WeakMap();
  const minSize = (element) => {
    if (!minimums.has(element)) {
      const initial = px(getComputedStyle(element).fontSize);
      minimums.set(element, Math.max(10, Math.min(20, initial * .45)));
    }
    return minimums.get(element);
  };
  const ownOverflow = (element) => {
    if (!element.clientWidth) return false;
    const style = getComputedStyle(element);
    const clipsVertically = style.overflowY === 'hidden' || style.overflowY === 'clip';
    return element.scrollWidth > element.clientWidth + 1 ||
      (clipsVertically && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1);
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
    const style = getComputedStyle(element);
    if (ownOverflow(element) && style.whiteSpace !== 'nowrap') {
      element.style.overflowWrap = 'anywhere';
      attempts = 0;
      while (ownOverflow(element) && attempts < 96 && shrinkOne(element)) attempts += 1;
    }
  };
  const isVisualContainer = (element) => {
    if (!element || element === root || !element.clientWidth || !element.clientHeight) return false;
    const style = getComputedStyle(element);
    const hasPaint = style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' ||
      px(style.borderTopWidth) + px(style.borderRightWidth) + px(style.borderBottomWidth) + px(style.borderLeftWidth) > 0;
    return hasPaint || style.overflowX === 'hidden' || style.overflowY === 'hidden' || style.overflowX === 'clip' || style.overflowY === 'clip';
  };
  const groupOverflow = (container, elements) => {
    const box = container.getBoundingClientRect();
    return elements.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
    });
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (const element of candidates) fitOwnBox(element);
    const groups = new Map();
    for (const element of candidates) {
      const container = element.parentElement;
      if (!isVisualContainer(container)) continue;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push(element);
    }
    for (const [container, elements] of groups) {
      let attempts = 0;
      while (groupOverflow(container, elements) && attempts < 96) {
        let changed = false;
        for (const element of elements) changed = shrinkOne(element) || changed;
        if (!changed) break;
        attempts += 1;
      }
    }
  }
  const unresolved = candidates.filter(ownOverflow);
  root.dataset.launchclipTextContainment = '${TEXT_CONTAINMENT_VERSION}';
  root.dataset.launchclipTextAdjusted = String(candidates.filter((element) => element.dataset.launchclipFitText === 'true').length);
  root.dataset.launchclipTextUnresolved = String(unresolved.length);
  window.__launchclipTextContainment = window.__launchclipTextContainment || [];
  window.__launchclipTextContainment.push({ shotId: ${JSON.stringify(String(shotId))}, adjusted: Number(root.dataset.launchclipTextAdjusted), unresolved: unresolved.map((element) => element.id || element.className || element.tagName) });
})();
</script>`;
}
