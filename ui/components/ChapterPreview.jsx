export function ChapterPreview({ id, trainers, randomTrainers, versionMismatch }) {
  return <details id={id} className="pc-chapter-preview">
    <summary>Dresseurs et équipes <span>{trainers.length}</span></summary>
    {versionMismatch && <p className="pc-preview-note" role="status">Version du jeu différente : les équipes peuvent avoir changé.</p>}
    <ol className="pc-preview-trainers">
      {trainers.map(trainer => <li key={trainer.key}>
        <div className="pc-preview-heading">
          <img className="pc-preview-portrait" loading="lazy" alt=""
            src={trainer.boss ? `assets/pokemon/${trainer.boss}.png` : `assets/trainers/${trainer.sprite}.png`}
            onError={event => { event.currentTarget.hidden = true; }} />
          <div><b>{trainer.name}</b><small>{trainer.location}</small></div>
        </div>
        <ol className="pc-preview-team" aria-label={`Équipe de ${trainer.name}`}>
          {trainer.team.map((mon, index) => <li key={index}>
            <img src={`assets/pokemon/${mon.id}.png`} loading="lazy" alt=""
              onError={event => { event.currentTarget.hidden = true; }} />
            <div><b>{mon.name}</b><small>Nv. {mon.level}</small></div>
          </li>)}
        </ol>
      </li>)}
    </ol>
    {randomTrainers > 0 && <p className="pc-preview-note">Les équipes des dresseurs de route et des assistants d’arène sont tirées au hasard.</p>}
  </details>;
}
