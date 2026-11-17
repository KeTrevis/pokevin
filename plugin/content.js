// @ts-check
(() => {
  "use strict";
  const {
    versionWarning,
    mountBadge,
    updateBadge,
    mountAdvisor,
    updateAdvisor,
    mountPreview,
    updatePreview,
    mountLeagueTooltip,
    updateLeagueTooltip,
    disposeDetached,
  } = globalThis.PokeCatchUI;
  /** @type {Set<number> | undefined} */
  let gymChapters;
  /** @type {number | undefined} */
  let scheduled;
  /** @type {string | undefined} */
  let lastRaw;
  /** @type {import("./types/domain").Save} */
  let save;
  /** @type {number | null} */
  let polling = null;
  /** @type {chrome.runtime.Port | undefined} */
  let optimizationPort;
  let optimizationId = 0;
  /** @type {import("./types/domain").Advice} */
  let advice = { status: "idle" };
  let applying = false;
  let versionMismatch = false;

  /** @type {import("./types/domain").ChapterVisit | undefined} */
  let visit;
  let visitRoamer = '';
  /** @type {Map<number, string> | undefined} */
  let roamingNames;
  let roamingNamesLoading = false;
  /** @type {chrome.runtime.Port | undefined} */
  let xpPort;
  /** @type {string | undefined} */
  let xpBundle;
  /** @type {{ requestId: number, chapter: import('./types/domain').XPTarget } | null} */
  let xpJob = null;
  let xpRequest = 0, xpRetryAt = 0;

  /** @param {string | undefined} expected */
  const matchesBundle = (expected) =>
    [...document.scripts].some((script) => {
      try {
        return new URL(script.src).pathname.endsWith("/" + expected);
      } catch {
        return false;
      }
    });
  /** @param {string} text @param {boolean} [mismatch] */
  const withVersionWarning = (text, mismatch = versionMismatch) =>
    mismatch ? `${text} ${versionWarning}`.trim() : text;

  function cancelXP() {
    if (xpJob) {
      try {
        xpPort?.postMessage({ type: "cancel" });
      } catch {}
    }
    xpJob = null;
  }

  /** @param {HTMLElement} badge @param {import("./types/domain").EstimateResult<import("./types/domain").XPResult>} result */
  function showXP(badge, result) {
    updateBadge(
      badge,
      "error" in result
        ? {
            value: "Indisponible",
            tooltip: withVersionWarning(result.error, !matchesBundle(xpBundle)),
            tone: "neutral",
          }
        : {
            value: `≈ ${Math.round(result.xpPerHour).toLocaleString("fr-FR")}`,
            tone: "info",
            tooltip: withVersionWarning(
              `${result.league ? "Ligue entière. " : ""}Vitesse effective ×${result.speed}. ${result.completed}/${result.runs} parcours terminés.`,
              !matchesBundle(xpBundle),
            ),
          },
    );
    badge.setAttribute("aria-busy", "false");
  }

  function updateXP() {
    const panel = document.querySelector("#screen-map.active .pg-info .mp-det");
    const chips = panel?.querySelector(".mp-in .mp-chips");
    const chapter = xpTarget();
    if (!chips || chapter === null) {
      cancelXP();
      panel?.querySelector("#pc-chapter-xp")?.closest("pc-ui-root")?.remove();
      return;
    }
    if (!visit) return;
    let badge = /** @type {HTMLElement | null} */ (chips.querySelector("#pc-chapter-xp"));
    if (!badge)
      badge = mountBadge(chips, {
        id: "pc-chapter-xp",
        label: "XP/h",
        value: "Calcul…",
        tooltip: "Calcul…",
      });
    if (visit.xp) { showXP(badge, visit.xp); return; }
    if (xpJob && xpJob.chapter !== chapter) cancelXP();
    if (!xpPort) {
      if (Date.now() < xpRetryAt) return;
      try {
        const connection = chrome.runtime.connect({ name: "chapter-xp" });
        xpPort = connection;
        connection.onMessage.addListener(/** @param {import("./types/domain").XPReply} message */ (message) => {
          if (xpPort !== connection) return;
          if (message.type === "ready") {
            xpBundle = message.bundle;
            gymChapters = new Set(message.chapters);
            schedule();
            return;
          }
          if (!xpJob || (!("requestId" in message) || message.requestId !== xpJob.requestId)) return;
          if (message.type === "result" || message.type === "error") {
            const result =
              message.type === "error" ? { error: message.message || "La simulation a échoué." } : message;
            if (visit) visit.xp = result;
            xpJob = null;
            schedule();
          }
        });
        connection.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (xpPort !== connection) return;
          xpPort = undefined;
          if (visit?.xpStarted && !visit.xp) visit.xp = { error: "Le calcul a été interrompu. Rouvre ce chapitre pour réessayer." };
          xpJob = null;
          xpRetryAt = Date.now() + 3000;
          schedule();
        });
      } catch {
        updateBadge(badge, { value: "Recharger", tone: "neutral" });
        xpRetryAt = Date.now() + 3000;
      }
      return;
    }
    if (!xpBundle) return;
    try {
      readSave();
      visit.save ||= structuredClone(save);
      if (visit.xpStarted) {
        badge.setAttribute("aria-busy", "true");
        return;
      }
      visit.xpStarted = true;
      xpJob = { chapter, requestId: ++xpRequest };
      badge.setAttribute("aria-busy", "true");
      xpPort.postMessage({ type: "xp", requestId: xpRequest, chapter, save: visit.save });
    } catch (error) {
      cancelXP();
      visit.xp = { error: (error instanceof Error ? error.message : String(error)) };
      showXP(badge, visit.xp);
    }
  }

  function renderChapterPreview() {
    if (document.hidden) return;
    const panel = document.querySelector("#screen-map.active .pg-info .ch-det:not(.det-out)");
    const button = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector(".mp-go[data-go]"));
    const chips = panel?.querySelector(".mp-in > .mp-chips");
    const data = globalThis.PokeCatchChapterData;
    if (!chips || !data || !panel) return;
    const target = button?.dataset.go;
    const mismatch = !matchesBundle(data.bundle);
    if (target === 'L') {
      const region = /** @type {HTMLElement | null} */ (document.querySelector('#map-root .rg.active[data-rg]'))?.dataset.rg;
      const league = data.chapters.filter(chapter => chapter.league && chapter.region === region).flatMap(chapter => chapter.trainers);
      for (const row of panel.querySelectorAll('.lg-mem')) {
        if (!(row instanceof HTMLElement)) continue;
        const sprite = row.querySelector('img')?.getAttribute('src')?.split('/').pop();
        const trainer = league.find(trainer => sprite === `${trainer.sprite}.png`);
        if (!trainer) continue;
        const tooltip = row.querySelector('pc-ui-root > span');
        if (tooltip) updateLeagueTooltip(tooltip, { trainer, versionMismatch: mismatch });
        else mountLeagueTooltip(row, trainer, mismatch);
      }
    }
    const chapters = /^\d+$/.test(target || "")
      ? [data.chapters[Number(target)]].filter(Boolean)
      : [];
    const trainers = chapters.flatMap((chapter) => chapter.trainers);
    const existing = /** @type {HTMLDetailsElement | null | undefined} */ (panel?.querySelector("#pc-chapter-preview"));
    if (!button || button.disabled || !trainers.length) {
      existing?.closest("pc-ui-root")?.remove();
      return;
    }
    const nativeLevel = chips.querySelector('.pg-lv');
    const levelTone = ['ok', 'tight', 'under', 'lock'].find(tone => nativeLevel?.classList.contains(tone)) || '';
    const key = `${target}:${data.bundle}:${mismatch}:${levelTone}`;
    if (existing?.dataset.chapter === key) return;
    const props = {
      id: "pc-chapter-preview",
      trainers,
      versionMismatch: mismatch,
      levelTone,
    };
    if (existing) {
      updatePreview(existing, props);
      existing.open = false;
    } else mountPreview(chips, props);
    const preview = /** @type {HTMLDetailsElement | null} */ (panel.querySelector("#pc-chapter-preview"));
    if (preview) preview.dataset.chapter = key;
  }

  function advisorPanel() {
    if (document.hidden) return null;
    const panel = document.querySelector("#screen-map.active .pg-info .ch-det:not(.det-out)");
    const target = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector(".mp-go[data-go]"))?.dataset.go;
    const chips = panel?.querySelector(".mp-in > .mp-chips");
    if (!chips || !/^\d+$/.test(target || "")) return null;
    if (gymChapters && !gymChapters.has(Number(target)) && !roamingKey()) {
      chips.parentElement
        ?.querySelector("#pc-team-advisor")
        ?.closest("pc-ui-root")
        ?.remove();
      return null;
    }
    return { chips, chapter: Number(target) };
  }

  function renderAdvisor(panel = advisorPanel()) {
    if (!panel || advice.chapter !== panel.chapter) return;
    const props = {
      id: "pc-team-advisor",
      advice,
      versionMismatch,
      onSearch: searchTeam,
      onCancel: cancelSearch,
      onApply: applyTeam,
    };
    const element = panel.chips.parentElement?.querySelector("#pc-team-advisor");
    if (element) updateAdvisor(element, props);
    else mountAdvisor(panel.chips, props);
  }

  function cancelSearch() {
    const connection = optimizationPort;
    optimizationPort = undefined;
    connection?.disconnect();
    if (advice.status === "searching") advice = { ...advice, status: "idle" };
    renderAdvisor();
  }

  async function applyTeam() {
    const panel = advisorPanel();
    if (
      !panel ||
      !advice.result ||
      applying ||
      advice.chapter !== panel.chapter
    )
      return;
    const proposal = advice.result.team;
    applying = true;
    advice = { ...advice, status: "applying" };
    renderAdvisor(panel);
    try {
      readSave();
      await PokeCatchTeams.apply(proposal, panel.chapter);
      advice = { ...advice, status: "result", applied: true };
    } catch (error) {
      advice = { ...advice, status: "error", message: (error instanceof Error ? error.message : String(error)) };
    } finally {
      applying = false;
      renderAdvisor();
      schedule();
    }
  }

  function refreshVersionWarning() {
    const compatible = matchesBundle(xpBundle);
    if (versionMismatch !== !compatible) {
      versionMismatch = !compatible;
      renderAdvisor();
    }
  }

  function readSave() {
    refreshVersionWarning();
    const raw = localStorage.getItem("gachamon-save-v1");
    if (!raw || raw.length > 16 * 1024 * 1024)
      throw new Error("Sauvegarde absente ou trop volumineuse.");
    if (raw !== lastRaw) {
      save = PokeCatchSave.parse(raw);
      lastRaw = raw;
    }
  }

  function searchTeam() {
    const panel = advisorPanel();
    if (!panel || advice.status === "searching") return;
    try {
      readSave();
      const connection = chrome.runtime.connect({ name: "arena-optimizer" });
      optimizationPort = connection;
      const id = ++optimizationId;
      advice = { chapter: panel.chapter, status: "searching", teams: 0 };
      connection.onMessage.addListener(/** @param {import("./types/domain").OptimizationReply} message */ (message) => {
        if (optimizationPort !== connection || (!("requestId" in message) || message.requestId !== id)) return;
        if (advisorPanel()?.chapter !== advice.chapter) {
          cancelSearch();
          schedule();
          return;
        }
        if (message.type === "optimization-progress")
          advice = { ...advice, stage: message.stage, teams: message.teams };
        else if (message.type === "optimization-result") {
          try {
            readSave();
            advice = { ...advice, status: "result", result: message };
          } catch (error) {
            advice = { ...advice, status: "error", message: (error instanceof Error ? error.message : String(error)) };
          }
          optimizationPort = undefined;
          connection.disconnect();
        } else if (["error", "unavailable"].includes(message.type)) {
          advice = {
            ...advice,
            status: "error",
            message:
              message.message || "Ce chapitre n’a pas de champion d’arène.",
          };
          optimizationPort = undefined;
          connection.disconnect();
        }
        renderAdvisor();
      });
      connection.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (optimizationPort !== connection) return;
        optimizationPort = undefined;
        advice = {
          ...advice,
          status: "error",
          message: "La recherche a été interrompue. Relance-la pour réessayer.",
        };
        renderAdvisor();
      });
      connection.postMessage({
        type: "optimize",
        requestId: id,
        chapter: panel.chapter,
        save,
      });
    } catch (error) {
      cancelSearch();
      advice = {
        chapter: panel.chapter,
        status: "error",
        message: (error instanceof Error ? error.message : String(error)),
      };
    }
    renderAdvisor(panel);
  }

  /** @returns {import('./types/domain').XPTarget | null} */
  function xpTarget() {
    const panel = document.querySelector('#screen-map.active .pg-info .mp-det:not(.det-out)');
    const button = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector('.mp-go[data-go], [data-zone]'));
    if (!button || button.disabled || panel?.closest('.det-out') || panel?.querySelector('.ev-hunt[hidden]')) return null;
    if (button.dataset.zone && /^\d+$/.test(button.dataset.zone)) return `zone:${Number(button.dataset.zone)}`;
    if (button.dataset.go === 'L') {
      const region = /** @type {HTMLElement | null} */ (document.querySelector('#map-root .rg.active[data-rg]'))?.dataset.rg || 'kanto';
      return `league:${region}`;
    }
    return /^\d+$/.test(button.dataset.go || '') ? Number(button.dataset.go) : null;
  }

  function roamingKey() {
    const chip = /** @type {HTMLElement | null} */ (document.querySelector('#screen-map.active .pg-info .ch-det:not(.det-out) .rm-chip[data-roam-until]'));
    return chip && Number(chip.dataset.roamUntil) > Date.now() ? `${chip.querySelector('img')?.getAttribute('src')}:${chip.dataset.roamUntil}` : '';
  }

  function syncVisit() {
    const chapter = xpTarget();
    const roamer = roamingKey();
    if (chapter === (visit?.chapter ?? null) && roamer === visitRoamer) return;
    cancelXP();
    cancelSearch();
    visit = chapter === null ? undefined : { chapter, xpStarted: false };
    visitRoamer = roamer;
    advice = { status: "idle", chapter: typeof chapter === 'number' ? chapter : undefined };
  }

  function renderRoamingTimeline() {
    const timeline = document.querySelector('#timeline');
    if (!timeline) return;
    const steps = [...timeline.querySelectorAll('.tl-node')];
    try { readSave(); } catch { return; }
    const adv = save.adv;
    const ordinary = adv && !adv.event && !adv.zone && !adv.tower && !adv.league &&
      adv.nodes?.length === steps.length;
    steps.forEach((step, index) => {
      const node = ordinary ? adv.nodes[index] : undefined;
      // The run keeps its assigned encounter even if the map's roaming timer expires.
      const id = node?.type === 'wild' && !save.roam?.caught?.includes(node.roamer || 0)
        ? node.roamer : undefined;
      const existing = step.querySelector('.pc-timeline-roamer');
      if (!id || !Number.isSafeInteger(id) || id < 1 || !step.classList.contains('wild')) {
        existing?.remove();
        return;
      }
      if (!roamingNames && !roamingNamesLoading) {
        roamingNamesLoading = true;
        chrome.runtime.sendMessage({ type: 'friend-pokedex-species' }).then(
          /** @param {import('./types/domain').DexCatalog} catalog */ catalog => {
            roamingNames = new Map(catalog.species.map(mon => [mon.id, mon.name]));
            schedule();
          },
        ).catch(() => { roamingNamesLoading = false; });
      }
      const name = roamingNames?.get(id) || 'Pokémon errant';
      const title = matchesBundle(PokeCatchChapterData.bundle) ? '' : versionWarning;
      const image = existing || document.createElement('img');
      if (image.getAttribute('data-id') !== String(id)) {
        image.setAttribute('data-id', String(id));
        image.setAttribute('src', `assets/pokemon/${id}.png`);
        image.className = 'pc-timeline-roamer';
      }
      if (image.getAttribute('alt') !== name) image.setAttribute('alt', name);
      // An empty title also suppresses the native step's inherited tooltip.
      if (image.getAttribute('title') !== title) image.setAttribute('title', title);
      if (!existing) step.append(image);
    });
  }

  function update() {
    if (applying || document.hidden) return;
    renderRoamingTimeline();
    syncVisit();
    if (xpBundle) refreshVersionWarning();
    renderChapterPreview();
    updateXP();
    const panel = advisorPanel();
    if (!panel || !visit) {
      cancelSearch();
      return;
    }
    const { chapter } = panel;
    if (advice.chapter !== chapter) {
      cancelSearch();
      advice = { chapter, status: "idle" };
    }
    renderAdvisor(panel);
    if (advice.applied && advice.result) {
      try {
        readSave();
        if (JSON.stringify(save.team) !== JSON.stringify(advice.result.team.map(mon => mon.uid))) {
          advice = { ...advice, applied: false };
          renderAdvisor(panel);
        }
      } catch {}
    }
  }

  function schedule() {
    if (polling !== null && !scheduled)
      scheduled = setTimeout(() => {
        scheduled = undefined;
        update();
      }, 150);
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) disposeDetached(record.removedNodes);
    if (!document.hidden && !applying && records.some(record =>
      record.target instanceof Element && record.target.closest('#timeline'))) {
      renderRoamingTimeline();
    }
    if (
      records.some(
        (record) =>
          (record.target instanceof Element && record.target.id === "screen-map") ||
          (record.target instanceof Element && record.target.id === "map-root") ||
          (record.target instanceof Element && record.target.closest("#map-root")) ||
          [...record.addedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.id === "map-root" || node.querySelector?.("#map-root")),
          ),
      )
    ) {
      if (!document.hidden && !applying) syncVisit();
      schedule();
    }
  });
  function start() {
    if (polling !== null) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    polling = setInterval(() => update(), 2000);
    schedule();
  }

  function stop() {
    cancelSearch();
    cancelXP();
    visit = undefined;
    const xpConnection = xpPort;
    xpPort = undefined;
    xpBundle = undefined;
    xpConnection?.disconnect();
    observer.disconnect();
    if (polling !== null) clearInterval(polling);
    polling = null;
    clearTimeout(scheduled);
    scheduled = undefined;
  }

  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  start();
})();
