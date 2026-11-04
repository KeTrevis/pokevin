// @ts-check
import { Badge } from './Badge.jsx';
import { TeamAdvisor } from './TeamAdvisor.jsx';
import { VERSION_WARNING } from '../version-warning.js';

/** @param {import('../../types/domain').EncounterCoachProps} props */
export function EncounterCoach({ id, choices, selected, result, advice, versionMismatch, onSelect, onSearch, onCancel, onApply }) {
  const error = result && 'error' in result ? result.error : '';
  const probability = result && !('error' in result) ? result.probability : null;
  const name = result && !('error' in result) ? result.champion : choices.find(choice => choice.id === selected)?.name;
  const tooltip = (error || `${name} · Duel direct, équipe soignée au départ. La capture est un tirage séparé.`) +
    (versionMismatch ? ` ${VERSION_WARNING}` : '');
  const tower = selected === 'tower';
  const circuit = selected.startsWith('league:');
  const additional = choices[0]?.kind === 'extra';
  const Container = additional ? 'details' : 'section';
  return <Container id={id} className="pc-encounter" aria-label="Simulation de rencontre">
    {additional && <summary>Autres rencontres</summary>}
    <div className="pc-encounter-heading">
      {choices.length > 1 ? <label>Rencontre<select aria-label="Rencontre" value={selected} onChange={event => onSelect(event.currentTarget.value)}>
        {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
      </select></label> : <b>{tower ? name || 'Prochain étage' : 'Duel direct'}</b>}
      <Badge id="pc-encounter-chance" icon="⚔️" label="Victoire" value={error ? 'Indisponible' : probability === null ? 'Calcul…' : `${Math.round(probability * 100)} %`}
        tone={probability === null ? 'neutral' : probability >= .65 ? 'positive' : probability < .4 ? 'negative' : 'caution'}
        tooltip={circuit ? (error || 'Circuit complet avec les combats intermédiaires et les soins prévus par le jeu. Équipe soignée au départ.') + (versionMismatch ? ` ${VERSION_WARNING}` : '') : tower ? (error || `${name || 'Prochain étage'} · Pokémon de la run, PV et statuts conservés.`) + (versionMismatch ? ` ${VERSION_WARNING}` : '') : tooltip} />
    </div>
    {!tower && !circuit && !selected.startsWith('raid:') && <TeamAdvisor id="pc-encounter-advisor" advice={advice} versionMismatch={versionMismatch}
      onSearch={onSearch} onCancel={onCancel} onApply={onApply} />}
  </Container>;
}
