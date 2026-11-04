export function ActionButton({ children, onClick, disabled = false }) {
  return <button type="button" className="btn small ghost pc-action" disabled={disabled} onClick={onClick}>
    {children}
  </button>;
}
