// @ts-check
import { ActionButton } from './ActionButton.jsx';
import { Tooltip } from './Tooltip.jsx';
import { VERSION_WARNING } from '../version-warning.js';

/** @param {number} value */
const percent = value => `${Math.round(value * 100)} %`;

/** @param {import("../../types/domain").AdvisorProps} props */
export function TeamAdvisor({ id, advice, versionMismatch, onSearch, onCancel, onApply }) {
  const searching = advice.status === 'searching';
  const result = advice.result;
  /** @param {import("react").ReactElement<import("react").ButtonHTMLAttributes<HTMLButtonElement> & { ref?: import("react").Ref<HTMLButtonElement> }>} action */
  const withWarning = action => versionMismatch ? <Tooltip content={VERSION_WARNING}>{action}</Tooltip> : action;
  return <div id={id} className="pc-advisor" data-status={advice.status} aria-busy={searching || advice.status === 'applying'}>
    <div className="pc-advisor-actions">
      {withWarning(<ActionButton onClick={onSearch} disabled={searching || advice.status === 'applying'}>
        {searching ? 'Recherche en cours…' : result ? 'Rechercher à nouveau' : '✨ Proposer une équipe'}
      </ActionButton>)}
      {searching && <ActionButton onClick={onCancel}>Annuler</ActionButton>}
    </div>
    {searching && <p className="pc-advisor-note" role="status">
      {advice.stage === 'validation' ? 'Comparaison finale' : 'Recherche de compositions'}
      {(advice.teams || 0) > 0 ? ` · ${advice.teams} équipes testées` : '…'}
    </p>}
    {advice.status === 'error' && <p className="pc-advisor-error" role="alert">{advice.message}</p>}
    {result && <section className="pc-advisor-result" aria-label="Proposition d’équipe">
      <div className="pc-advisor-heading"><h5>Meilleure équipe trouvée</h5><strong data-tone={result.probability >= .65 ? 'positive' : result.probability < .4 ? 'negative' : 'caution'}>{percent(result.probability)}</strong></div>
      <ol className="pc-advisor-team">
        {result.team.map(mon => <li key={mon.uid} data-uid={mon.uid}>
          <img src={`assets/pokemon/${mon.shiny ? 'shiny/' : ''}${mon.id}.png`} alt="" onError={event => { event.currentTarget.hidden = true; }} />
          <div><b>{mon.name}{mon.shiny ? ' ✨' : ''}</b><small>Nv. {mon.level}</small></div>
        </li>)}
      </ol>
      {withWarning(<ActionButton onClick={onApply} disabled={advice.status === 'applying' || advice.applied}>
        {advice.status === 'applying' ? 'Application…' : advice.applied ? 'Équipe appliquée' : 'Appliquer cette équipe'}
      </ActionButton>)}
    </section>}
  </div>;
}
