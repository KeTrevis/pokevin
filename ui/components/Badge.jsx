import { Tooltip } from './Tooltip.jsx';

export function Badge({ id, icon, label, value = '', tone = 'neutral', tooltip, onClick }) {
  const Element = onClick ? 'button' : 'span';
  const badge = <Element id={id} className="pc-badge" data-tone={tone}
    type={onClick ? 'button' : undefined} onClick={onClick}
    aria-label={`${label} ${value}`}>
    {icon && <i aria-hidden="true">{icon}</i>}
    {label}<b>{value}</b>
  </Element>;
  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}
