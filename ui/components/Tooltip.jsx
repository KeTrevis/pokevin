// @ts-check
import { cloneElement, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** @param {Element | null} element @param {EventTarget | null} target */
const contains = (element, target) => target instanceof Node && !!element?.contains(target);

// A single DOM element is the trigger; the bubble uses the game's native classes.
/** @param {{ content: import("react").ReactNode, children?: import("react").ReactElement<import("react").HTMLAttributes<HTMLElement> & { ref?: import("react").Ref<HTMLElement> }>, anchorElement?: HTMLElement, interactive?: boolean, className?: string }} props */
export function Tooltip({ content, children, anchorElement, interactive = false, className = '' }) {
  const id = useId();
  const anchor = useRef(/** @type {HTMLElement | null} */ (null));
  const bubble = useRef(/** @type {HTMLDivElement | null} */ (null));
  const closeTimer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, visibility: /** @type {'hidden' | 'visible'} */ ('hidden') });
  const leave = () => {
    clearTimeout(closeTimer.current);
    if (interactive) closeTimer.current = setTimeout(() => setOpen(false), 150);
    else setOpen(false);
  };
  useLayoutEffect(() => () => clearTimeout(closeTimer.current), []);

  // League rows belong to the game; attach the same tooltip without replacing their DOM.
  useLayoutEffect(() => {
    if (!anchorElement) return;
    anchor.current = anchorElement;
    const tabIndex = anchorElement.getAttribute('tabindex');
    const description = anchorElement.getAttribute('aria-describedby');
    anchorElement.tabIndex = 0;
    anchorElement.setAttribute('aria-describedby', [description, id].filter(Boolean).join(' '));
    const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
    /** @param {PointerEvent} event */
    const enter = event => { if (event.pointerType === 'mouse') show(); };
    const exit = () => { if (document.activeElement !== anchorElement) leave(); };
    /** @param {FocusEvent} event */
    const blur = event => { if (!contains(bubble.current, event.relatedTarget)) setOpen(false); };
    /** @param {PointerEvent} event */
    const touch = event => { if (event.pointerType === 'touch') setOpen(value => !value); };
    /** @param {KeyboardEvent} event */
    const key = event => { if (event.key === 'Escape') setOpen(false); };
    anchorElement.addEventListener('pointerenter', enter);
    anchorElement.addEventListener('pointerleave', exit);
    anchorElement.addEventListener('focus', show);
    anchorElement.addEventListener('blur', blur);
    anchorElement.addEventListener('pointerdown', touch);
    anchorElement.addEventListener('keydown', key);
    return () => {
      anchorElement.removeEventListener('pointerenter', enter);
      anchorElement.removeEventListener('pointerleave', exit);
      anchorElement.removeEventListener('focus', show);
      anchorElement.removeEventListener('blur', blur);
      anchorElement.removeEventListener('pointerdown', touch);
      anchorElement.removeEventListener('keydown', key);
      /** @type {Array<[string, string | null]>} */
      const attributes = [['tabindex', tabIndex], ['aria-describedby', description]];
      for (const [name, value] of attributes) {
        if (value === null) anchorElement.removeAttribute(name);
        else anchorElement.setAttribute(name, value);
      }
    };
  }, [anchorElement, id, interactive]);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const anchorElement = anchor.current, bubbleElement = bubble.current;
    const rect = anchorElement.getBoundingClientRect();
    const width = bubbleElement.offsetWidth;
    const height = bubbleElement.offsetHeight;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 12));
    const top = rect.top - height - 8 >= 12 ? rect.top - height - 8 : rect.bottom + 8;
    setPosition({ left, top: Math.max(12, Math.min(top, innerHeight - height - 12)), visibility: 'visible' });
    const close = () => setOpen(false);
    /** @param {Event} event */
    const scroll = event => { if (!interactive || !contains(bubbleElement, event.target)) close(); };
    /** @param {PointerEvent} event */
    const outside = event => {
      if (!contains(anchorElement, event.target) && !contains(bubbleElement, event.target)) close();
    };
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    if (interactive) document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, content, children, interactive]);

  return <>
    {children ? cloneElement(children, {
      ref: element => {
        anchor.current = element;
        const ref = children.props.ref;
        if (typeof ref === 'function') return ref(element);
        if (ref) ref.current = element;
      },
      tabIndex: children.props.tabIndex ?? 0,
      'aria-describedby': id,
      onPointerEnter: event => {
        clearTimeout(closeTimer.current);
        children.props.onPointerEnter?.(event);
        if (event.pointerType === 'mouse') setOpen(true);
      },
      onPointerLeave: event => {
        children.props.onPointerLeave?.(event);
        if (interactive && contains(bubble.current, event.relatedTarget)) return;
        if (document.activeElement !== anchor.current) leave();
      },
      onPointerDown: event => {
        children.props.onPointerDown?.(event);
        if (interactive && event.pointerType === 'touch') setOpen(value => !value);
      },
      onFocus: event => { clearTimeout(closeTimer.current); children.props.onFocus?.(event); setOpen(true); },
      onBlur: event => {
        children.props.onBlur?.(event);
        if (!interactive || !contains(bubble.current, event.relatedTarget)) setOpen(false);
      },
      onKeyDown: event => {
        children.props.onKeyDown?.(event);
        if (event.key === 'Escape') setOpen(false);
      },
    }) : <span hidden />}
    {createPortal(<div ref={bubble} id={id} role="tooltip" hidden={!open}
      className={`bag-tip info-tip-box ftip pc-tooltip ${className}`} style={{ ...position, ...(interactive ? { pointerEvents: 'auto' } : {}) }}
      onPointerEnter={() => clearTimeout(closeTimer.current)}
      onPointerLeave={event => {
        if (interactive && !contains(anchor.current, event.relatedTarget) && document.activeElement !== anchor.current &&
            !bubble.current?.contains(document.activeElement)) leave();
      }}
      onBlur={event => {
        if (interactive && !contains(bubble.current, event.relatedTarget) && !contains(anchor.current, event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => { if (event.key === 'Escape') { anchor.current?.focus(); setOpen(false); } }}>
      {(!interactive || open) && content}
    </div>, document.body)}
  </>;
}
