// @ts-check
import { Tooltip } from './Tooltip.jsx';
import { VERSION_WARNING } from '../version-warning.js';

/** @param {import("react").SyntheticEvent<HTMLImageElement>} event */
const hideImage = event => { event.currentTarget.hidden = true; };

/** @param {{trainer: import('../../types/domain').TrainerPreview, versionMismatch: boolean}} props */
function TrainerTeam({ trainer, versionMismatch }) {
  return <>
    <b>{trainer.name} · {trainer.location}</b>
    <div className="pc-preview-roster" tabIndex={0} aria-label={`Équipe de ${trainer.name}`}>
      <ol className="pc-preview-team">
        {trainer.team.map((mon, index) => <li key={index}>
          <img src={`assets/pokemon/${mon.id}.png`} loading="lazy" alt="" onError={hideImage} />
          <div><b>{mon.name}</b><small>Nv. {mon.level}</small></div>
        </li>)}
      </ol>
    </div>
    {versionMismatch && <p className="pc-preview-note">{VERSION_WARNING}</p>}
  </>;
}

/** @param {{anchorElement: HTMLElement, trainer: import('../../types/domain').TrainerPreview, versionMismatch: boolean}} props */
export function LeagueTeamTooltip({ anchorElement, trainer, versionMismatch }) {
  return <Tooltip anchorElement={anchorElement} interactive className="pc-trainer-tooltip"
    content={<TrainerTeam trainer={trainer} versionMismatch={versionMismatch} />} />;
}

/** @param {import("../../types/domain").PreviewProps} props */
export function ChapterPreview({ id, trainers, versionMismatch, levelTone }) {
  return <details id={id} className="pc-chapter-preview">
    <summary>Champions d’arène <span>{trainers.length}</span></summary>
    <ol className="lg-mems pc-preview-trainers">
      {trainers.map(trainer => <li key={trainer.key}>
        <Tooltip interactive className="pc-trainer-tooltip"
          content={<TrainerTeam trainer={trainer} versionMismatch={versionMismatch} />}>
          <button type="button" className="lg-mem pc-preview-trainer" aria-label={`${trainer.name} · ${trainer.location}`}>
            <span className="ch-av" aria-hidden="true">
              <span className="tr-face ch-face" data-frame="base">
                <span className="tr-win"><img src={`assets/trainers/still/${trainer.sprite}.png`} loading="lazy" alt="" onError={hideImage} /></span><i className="fr" />
              </span>
            </span>
            <span className="lg-who"><b>{trainer.name}</b>
              <span className="type sm" data-type={trainer.type} style={{background: trainer.color}}>{trainer.typeName}</span>
            </span>
            <span className="lg-lv"><span className={`pg-lv ${levelTone}`}>Niv. conseillé <b>{trainer.min === trainer.max ? trainer.min : `${trainer.min}–${trainer.max}`}</b></span>
              <span>Plafond <b>{trainer.cap}</b></span>
            </span>
          </button>
        </Tooltip>
      </li>)}
    </ol>
  </details>;
}
