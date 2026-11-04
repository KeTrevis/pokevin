import { cloneElement, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const contains = (element, target) => !!target?.nodeType && element?.contains(target);

// A single DOM element is the trigger; the bubble uses the game's native classes.
export function Tooltip({ content, children, interactive = false, className = '' }) {
  const id = useId();
  const anchor = useRef(null);
  const bubble = useRef(null);
  const closeTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, visibility: 'hidden' });
  const leave = () => {
    clearTimeout(closeTimer.current);
    if (interactive) closeTimer.current = setTimeout(() => setOpen(false), 150);
    else setOpen(false);
  };
  useLayoutEffect(() => () => clearTimeout(closeTimer.current), []);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = anchor.current.getBoundingClientRect();
    const width = bubble.current.offsetWidth;
    const height = bubble.current.offsetHeight;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 12));
    const top = rect.top - height - 8 >= 12 ? rect.top - height - 8 : rect.bottom + 8;
    setPosition({ left, top: Math.max(12, Math.min(top, innerHeight - height - 12)), visibility: 'visible' });
    const close = () => setOpen(false);
    const scroll = event => { if (!interactive || !bubble.current.contains(event.target)) close(); };
    const outside = event => {
      if (!anchor.current.contains(event.target) && !bubble.current.contains(event.target)) close();
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
    {cloneElement(children, {
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
    })}
    {createPortal(<div ref={bubble} id={id} role="tooltip" hidden={!open}
      className={`bag-tip info-tip-box ftip pc-tooltip ${className}`} style={{ ...position, ...(interactive ? { pointerEvents: 'auto' } : {}) }}
      onPointerEnter={() => clearTimeout(closeTimer.current)}
      onPointerLeave={event => {
        if (interactive && !contains(anchor.current, event.relatedTarget) && document.activeElement !== anchor.current &&
            !bubble.current.contains(document.activeElement)) leave();
      }}
      onBlur={event => {
        if (interactive && !contains(bubble.current, event.relatedTarget) && !contains(anchor.current, event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => { if (event.key === 'Escape') { anchor.current.focus(); setOpen(false); } }}>
      {(!interactive || open) && content}
    </div>, document.body)}
  </>;
}
