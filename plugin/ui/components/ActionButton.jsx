// @ts-check
/** @param {import("react").ButtonHTMLAttributes<HTMLButtonElement> & { ref?: import("react").Ref<HTMLButtonElement> }} props */
export function ActionButton({ children, onClick, disabled = false, ...props }) {
  return <button type="button" className="btn small ghost pc-action" disabled={disabled} onClick={onClick} {...props}>
    {children}
  </button>;
}
