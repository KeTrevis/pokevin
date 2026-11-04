// @ts-check
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Badge } from './components/Badge.jsx';
import { TeamAdvisor } from './components/TeamAdvisor.jsx';
import { ChapterPreview } from './components/ChapterPreview.jsx';
import { VERSION_WARNING } from './version-warning.js';
import './friend-dex.jsx';
import './pension.js';

// Small bridge for the existing non-React simulation controller.
/** @type {WeakMap<Element, { update(patch: object): void, dispose(): void }>} */
const badges = new WeakMap();
/** @type {WeakMap<Element, { update(patch: object): void, dispose(): void }>} */
const hosts = new WeakMap();

/** @template {object} P @template {HTMLElement} E @param {Element} container @param {import("react").ComponentType<P>} Component @param {P} initialProps @returns {E} */
function mountComponent(container, Component, initialProps) {
  // A distinct tag prevents the game's DOM morph from reusing our React root as a native span.
  const host = document.createElement('pc-ui-root');
  const root = createRoot(host, { identifierPrefix: 'pc-ext-' });
  let props = initialProps;
  container.append(host);
  const render = () => flushSync(() => root.render(<Component {...props} />));
  render();
  const element = /** @type {E | null} */ (host.firstElementChild);
  if (!element) throw new Error("Le composant de l’extension ne s’est pas affiché.");
  const controller = {
    /** @param {Partial<P>} patch */
    update(patch) {
      if (!Object.entries(patch).some(([key, value]) => Reflect.get(props, key) !== value)) return;
      props = { ...props, ...patch };
      render();
    },
    dispose() {
      root.unmount();
      badges.delete(element);
      hosts.delete(host);
    },
  };
  badges.set(element, controller);
  hosts.set(host, controller);
  return element;
}

/** @param {Element} container @param {import("../types/domain").BadgeProps} props @returns {HTMLElement} */
const mountBadge = (container, props) => mountComponent(container, Badge, props);
/** @param {Element} after @param {import("../types/domain").AdvisorProps} props */
function mountAdvisor(after, props) {
  if (!after.parentElement) throw new Error("Le panneau du chapitre est fermé.");
  const element = mountComponent(after.parentElement, TeamAdvisor, props);
  const host = element.closest('pc-ui-root');
  if (host) after.after(host);
  return element;
}

/** @param {Element} after @param {import("../types/domain").PreviewProps} props @returns {HTMLDetailsElement} */
function mountPreview(after, props) {
  if (!after.parentElement) throw new Error("Le panneau du chapitre est fermé.");
  /** @type {HTMLDetailsElement} */
  const element = mountComponent(after.parentElement, ChapterPreview, props);
  const host = element.closest('pc-ui-root');
  if (host) after.after(host);
  return element;
}

/** @param {Element} element @param {object} patch */
function updateBadge(element, patch) {
  badges.get(element)?.update(patch);
}

/** @param {NodeList} nodes */
function disposeDetached(nodes) {
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    const removed = node.matches('pc-ui-root') ? [node] : node.querySelectorAll('pc-ui-root');
    for (const host of removed) if (!host.isConnected) hosts.get(host)?.dispose();
  }
}

globalThis.PokeCatchUI = Object.freeze({ versionWarning: VERSION_WARNING, mountBadge, updateBadge, mountAdvisor, updateAdvisor: updateBadge,
  mountPreview, updatePreview: updateBadge, disposeDetached });
