import { cloneElement, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A single DOM element is the trigger; the bubble uses the game's native classes.
export function Tooltip({ content, children }) {
  const id = useId();
  const anchor = useRef(null);
  const bubble = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const rect = anchor.current.getBoundingClientRect();
    const width = bubble.current.offsetWidth;
    const height = bubble.current.offsetHeight;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 12));
    const top = rect.top - height - 8 >= 12 ? rect.top - height - 8 : rect.bottom + 8;
    setPosition({ left, top: Math.max(12, Math.min(top, innerHeight - height - 12)), visibility: 'visible' });
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, content, children]);

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
        children.props.onPointerEnter?.(event);
        if (event.pointerType === 'mouse') setOpen(true);
      },
      onPointerLeave: event => {
        children.props.onPointerLeave?.(event);
        if (document.activeElement !== anchor.current) setOpen(false);
      },
      onFocus: event => { children.props.onFocus?.(event); setOpen(true); },
      onBlur: event => { children.props.onBlur?.(event); setOpen(false); },
      onKeyDown: event => {
        children.props.onKeyDown?.(event);
        if (event.key === 'Escape') setOpen(false);
      },
    })}
    {createPortal(<div ref={bubble} id={id} role="tooltip" hidden={!open}
      className="bag-tip info-tip-box ftip pc-tooltip" style={position}>
      {content}
    </div>, document.body)}
  </>;
}
