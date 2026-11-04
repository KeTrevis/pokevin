// @ts-check
import { Tooltip } from './Tooltip.jsx';
import { VERSION_WARNING } from '../version-warning.js';

/** @param {number | undefined} min @param {number | undefined} max */
const range = (min, max) => min === max ? min : `${min}–${max}`;
/** @param {import("react").SyntheticEvent<HTMLImageElement>} event */
const hideImage = event => { event.currentTarget.hidden = true; };

/** @param {import("../../types/domain").PreviewProps} props */
export function ChapterPreview({ id, trainers, versionMismatch }) {
  const summary = <summary>Dresseurs et équipes <span>{trainers.reduce((sum, trainer) => sum + (trainer.count || 1), 0)}</span></summary>;
  return <details id={id} className="pc-chapter-preview">
    {versionMismatch ? <Tooltip content={VERSION_WARNING}>{summary}</Tooltip> : summary}
    <ol className="pc-preview-trainers">
      {trainers.map(trainer => <li key={trainer.key}>
        <Tooltip interactive className="pc-trainer-tooltip" content={<>
          <b>{trainer.name} · {trainer.location}</b>
          {trainer.random && <>
            <p className="pc-preview-note">Équipe aléatoire · {range(...trainer.size)} Pokémon par combat</p>
            <b>Pokémon possibles</b>
          </>}
          <div className="pc-preview-roster" tabIndex={0} aria-label={trainer.random ? 'Pokémon possibles' : `Équipe de ${trainer.name}`}>
            <ol className="pc-preview-team">
              {trainer.team.map((mon, index) => <li key={index}>
                <img src={`assets/pokemon/${mon.id}.png`} loading="lazy" alt="" onError={hideImage} />
                <div><b>{mon.name}</b><small>Nv. {mon.level ?? range(mon.min, mon.max)}</small></div>
              </li>)}
            </ol>
          </div>
        </>}>
          <button type="button" className="pc-preview-trainer" aria-label={`${trainer.name} · ${trainer.location}`}>
            <span className="pc-preview-faces" aria-hidden="true">
              {trainer.random ? trainer.classes.slice(0, 3).map(cls =>
                <img key={cls.sprite} src={`assets/trainers/${cls.sprite}.png`} loading="lazy" alt="" onError={hideImage} />) :
                <img src={trainer.boss ? `assets/pokemon/${trainer.boss}.png` : `assets/trainers/${trainer.sprite}.png`}
                  loading="lazy" alt="" onError={hideImage} />}
            </span>
            <span className="pc-preview-identity"><b>{trainer.name}</b><small>{trainer.location}</small></span>
            <small className="pc-preview-count">{(trainer.count || 0) > 1 ? `×${trainer.count} · ` : ''}
              {trainer.random ? 'Aléatoire' : `${trainer.team.length} Pokémon`}</small>
          </button>
        </Tooltip>
      </li>)}
    </ol>
  </details>;
}
