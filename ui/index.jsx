import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Badge } from './components/Badge.jsx';
import { TeamAdvisor } from './components/TeamAdvisor.jsx';
import { ChapterPreview } from './components/ChapterPreview.jsx';

// Small bridge for the existing non-React simulation controller.
const badges = new WeakMap();
const hosts = new WeakMap();

function mountComponent(container, Component, initialProps) {
  // A distinct tag prevents the game's DOM morph from reusing our React root as a native span.
  const host = document.createElement('pc-ui-root');
  const root = createRoot(host, { identifierPrefix: 'pc-ext-' });
  let props = initialProps;
  container.append(host);
  const render = () => flushSync(() => root.render(<Component {...props} />));
  render();
  const element = host.firstElementChild;
  const controller = {
    update(patch) {
      if (!Object.entries(patch).some(([key, value]) => props[key] !== value)) return;
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

const mountBadge = (container, props) => mountComponent(container, Badge, props);
function mountAdvisor(after, props) {
  const element = mountComponent(after.parentElement, TeamAdvisor, props);
  after.after(element.closest('pc-ui-root'));
  return element;
}

function mountPreview(after, props) {
  const element = mountComponent(after.parentElement, ChapterPreview, props);
  after.after(element.closest('pc-ui-root'));
  return element;
}

function updateBadge(element, patch) {
  badges.get(element)?.update(patch);
}

function disposeDetached(nodes) {
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;
    const removed = node.matches('pc-ui-root') ? [node] : node.querySelectorAll('pc-ui-root');
    for (const host of removed) if (!host.isConnected) hosts.get(host)?.dispose();
  }
}

globalThis.PokeCatchUI = Object.freeze({ mountBadge, updateBadge, mountAdvisor, updateAdvisor: updateBadge,
  mountPreview, updatePreview: updateBadge, disposeDetached });
