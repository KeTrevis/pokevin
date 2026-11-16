// @ts-check
// Supply an extension URL without granting the page access to extension APIs.
(() => {
  const mount = () => document.documentElement.setAttribute('data-pokevin-editor', chrome.runtime.getURL('ui/script-editor.html'));
  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
