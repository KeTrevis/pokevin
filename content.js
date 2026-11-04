// @ts-check
(() => {
  "use strict";
  const BADGE_ID = "pc-arena-chance";
  const {
    versionWarning,
    mountBadge,
    updateBadge,
    mountAdvisor,
    updateAdvisor,
    mountPreview,
    updatePreview,
    disposeDetached,
  } = globalThis.PokeCatchUI;
  const TOOLTIP =
    "Chance of defeating the Gym Leader, calculated with the current team at 100% HP.";
  /** @param {number} value */
  const percent = (value) =>
    `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  /** @type {chrome.runtime.Port | undefined} */
  let port;
  /** @type {string | undefined} */
  let bundle;
  /** @type {Set<number> | undefined} */
  let gymChapters;
  let requestId = 0;
  /** @type {{ requestId: number, chapter: number } | null} */
  let active = null;
  /** @type {number | undefined} */
  let scheduled;
  /** @type {string | undefined} */
  let lastRaw;
  /** @type {import("./types/domain").Save} */
  let save;
  let lastPing = 0, retryAt = 0;
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
  /** @type {chrome.runtime.Port | undefined} */
  let xpPort;
  /** @type {string | undefined} */
  let xpBundle;
  /** @type {{ requestId: number, chapter: number } | null} */
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
    const panel = document.querySelector("#screen-map.active .pg-info .ch-det");
    const button = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector(".mp-go[data-go]"));
    const chips = panel?.querySelector(".mp-in > .mp-chips");
    const target = button?.dataset.go;
    if (
      !chips ||
      !button || button.disabled ||
      !/^\d+$/.test(target || "")
    ) {
      cancelXP();
      panel?.querySelector("#pc-chapter-xp")?.closest("pc-ui-root")?.remove();
      return;
    }
    const chapter = Number(target);
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
    const panel = document.querySelector("#screen-map.active .pg-info .ch-det");
    const button = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector(".mp-go[data-go]"));
    const chips = panel?.querySelector(".mp-in > .mp-chips");
    const data = globalThis.PokeCatchChapterData;
    if (!chips || !data || !panel) return;
    const target = button?.dataset.go;
    const chapters = /^\d+$/.test(target || "")
      ? [data.chapters[Number(target)]].filter(Boolean)
      : [];
    const trainers = chapters.flatMap((chapter) => chapter.trainers);
    const existing = /** @type {HTMLDetailsElement | null | undefined} */ (panel?.querySelector("#pc-chapter-preview"));
    if (!button || button.disabled || !trainers.length) {
      existing?.closest("pc-ui-root")?.remove();
      return;
    }
    const mismatch = !matchesBundle(data.bundle);
    const key = `${target}:${data.bundle}:${mismatch}`;
    if (existing?.dataset.chapter === key) return;
    const props = {
      id: "pc-chapter-preview",
      trainers,
      versionMismatch: mismatch,
    };
    if (existing) {
      updatePreview(existing, props);
      existing.open = false;
    } else mountPreview(chips, props);
    const preview = /** @type {HTMLDetailsElement | null} */ (panel.querySelector("#pc-chapter-preview"));
    if (preview) preview.dataset.chapter = key;
  }

  function badgeForPanel() {
    if (document.hidden) return null;
    const panel = document.querySelector("#screen-map.active .pg-info .ch-det");
    const target = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector(".mp-go[data-go]"))?.dataset.go;
    const chips = panel?.querySelector(".mp-in > .mp-chips");
    if (!chips || !/^\d+$/.test(target || "")) return null;
    if (gymChapters && !gymChapters.has(Number(target))) {
      chips.querySelector(`#${BADGE_ID}`)?.closest("pc-ui-root")?.remove();
      chips.parentElement
        ?.querySelector("#pc-team-advisor")
        ?.closest("pc-ui-root")
        ?.remove();
      return null;
    }
    let badge = /** @type {HTMLElement | null} */ (chips.querySelector(`#${BADGE_ID}`));
    if (!badge) {
      badge = mountBadge(chips, {
        id: BADGE_ID,
        icon: "⚔️",
        label: "Victoire",
        value: "Calcul…",
        tooltip: TOOLTIP,
      });
      if (visit?.gym && !("error" in visit.gym)) showResult(badge, visit.gym);
    }
    return { badge, chips, chapter: Number(target) };
  }

  function renderAdvisor(panel = badgeForPanel()) {
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
    const panel = badgeForPanel();
    if (
      !panel ||
      !advice.result ||
      applying ||
      advice.chapter !== panel.chapter
    )
      return;
    const proposal = advice.result.team;
    applying = true;
    cancel();
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
    const compatible = matchesBundle(bundle || xpBundle);
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
      save = JSON.parse(raw);
      lastRaw = raw;
    }
  }

  function searchTeam() {
    const panel = badgeForPanel();
    if (!panel || advice.status === "searching") return;
    try {
      readSave();
      const connection = chrome.runtime.connect({ name: "arena-optimizer" });
      optimizationPort = connection;
      const id = ++optimizationId;
      advice = { chapter: panel.chapter, status: "searching", teams: 0 };
      connection.onMessage.addListener(/** @param {import("./types/domain").OptimizationReply} message */ (message) => {
        if (optimizationPort !== connection || (!("requestId" in message) || message.requestId !== id)) return;
        if (badgeForPanel()?.chapter !== advice.chapter) {
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

  /** @param {HTMLElement} badge @param {string} text @param {"pending" | "good" | "poor" | "result" | "error"} [state] */
  function paint(badge, text, state = "pending") {
    updateBadge(badge, {
      value: text,
      tooltip: withVersionWarning(TOOLTIP),
      tone: state === "good" ? "positive" : state === "poor" ? "negative" : state === "result" ? "caution" : "neutral",
    });
    if (badge.dataset.state !== state) badge.dataset.state = state;
    if (state === "error") badge.setAttribute("aria-busy", "false");
  }

  /** @param {HTMLElement} badge @param {import("./types/domain").GymResult} result @param {boolean} [updating] */
  function showResult(badge, result, updating = false) {
    paint(
      badge,
      percent(result.probability),
      result.probability >= 0.65
        ? "good"
        : result.probability < 0.4
          ? "poor"
          : "result",
    );
    badge.dataset.champion = result.champion;
    if (badge.getAttribute("aria-busy") !== String(updating))
      badge.setAttribute("aria-busy", String(updating));
  }

  /** @param {HTMLElement} badge */
  function showPending(badge) {
    paint(badge, "Calcul…");
    if (badge.getAttribute("aria-busy") !== "true") badge.setAttribute("aria-busy", "true");
  }

  function cancel() {
    if (active) {
      try {
        port?.postMessage({ type: "cancel" });
      } catch {}
    }
    active = null;
  }

  function connect() {
    if (port) return;
    try {
      const connection = chrome.runtime.connect({ name: "arena-coach" });
      port = connection;
      connection.onMessage.addListener(/** @param {import("./types/domain").GymReply} message */ (message) => {
        if (port !== connection) return;
        if (message.type === "ready") {
          bundle = message.bundle;
          gymChapters = new Set(message.chapters);
          schedule();
          return;
        }
        if (!active || !("requestId" in message) || message.requestId !== active.requestId) return;
        const panel = badgeForPanel();
        if (message.type === "result") {
          if (visit) visit.gym = message;
          if (panel && panel.chapter === active.chapter)
            showResult(panel.badge, message);
          active = null;
        } else if (message.type === "error" || message.type === "unavailable") {
          if (panel && panel.chapter === active.chapter) {
            if (message.type === "unavailable")
              panel.badge.closest("pc-ui-root")?.remove();
            else paint(panel.badge, "Indisponible", "error");
          }
          if (visit) visit.gym = { error: message.message || "Ce chapitre n’a pas de champion d’arène." };
          active = null;
        } else if (
          message.type === "progress" &&
          panel && panel.chapter === active.chapter
        ) {
          showPending(panel.badge);
        }
      });
      connection.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port !== connection) return;
        port = undefined;
        if (visit?.gymStarted && !visit.gym) visit.gym = { error: "Le calcul a été interrompu. Rouvre ce chapitre pour réessayer." };
        active = null;
        retryAt = Date.now() + 3000;
      });
    } catch {
      port = undefined;
      const panel = badgeForPanel();
      if (panel) paint(panel.badge, "Recharger", "error");
      retryAt = Date.now() + 3000;
    }
  }

  function syncVisit() {
    const button = /** @type {HTMLButtonElement | null} */ (document.querySelector("#screen-map.active .pg-info .ch-det .mp-go[data-go]"));
    const chapter = button && !button.disabled && /^\d+$/.test(button.dataset.go || "") ? Number(button.dataset.go) : null;
    if (chapter === (visit?.chapter ?? null)) return;
    cancel();
    cancelXP();
    cancelSearch();
    visit = chapter === null ? undefined : { chapter, xpStarted: false, gymStarted: false };
    advice = { status: "idle", chapter: chapter ?? undefined };
  }

  function update() {
    if (applying || document.hidden) return;
    syncVisit();
    if (bundle || xpBundle) refreshVersionWarning();
    renderChapterPreview();
    updateXP();
    const panel = badgeForPanel();
    if (!panel || !visit) {
      cancel();
      cancelSearch();
      return;
    }
    const { badge, chapter } = panel;
    if (advice.chapter !== chapter) {
      cancelSearch();
      advice = { chapter, status: "idle" };
    }
    renderAdvisor(panel);
    if (active && active.chapter !== chapter) cancel();
    if (visit.gym) {
      if ("error" in visit.gym) paint(badge, "Indisponible", "error");
      else showResult(badge, visit.gym);
      return;
    }
    if (!port || !bundle) {
      showPending(badge);
      if (Date.now() >= retryAt) connect();
      return;
    }
    if (Date.now() - lastPing > 20000) {
      try {
        port.postMessage({ type: "ping" });
        lastPing = Date.now();
      } catch {
        return;
      }
    }
    try {
      readSave();
      if (
        advice.applied && advice.result &&
        JSON.stringify(save.team) !==
          JSON.stringify(advice.result?.team.map((mon) => mon.uid))
      ) {
        advice = { ...advice, applied: false };
        renderAdvisor(panel);
      }
      visit.save ||= structuredClone(save);
      if (visit.gymStarted) return;
      visit.gymStarted = true;
      showPending(badge);
      active = { requestId: ++requestId, chapter };
      port.postMessage({ type: "run", requestId, chapter, save: visit.save });
    } catch (error) {
      cancel();
      if (visit) visit.gym = { error: (error instanceof Error ? error.message : String(error)) };
      paint(badge, "Indisponible", "error");
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
    retryAt = 0;
    lastPing = 0;
    schedule();
  }

  function stop() {
    cancel();
    cancelSearch();
    cancelXP();
    visit = undefined;
    const xpConnection = xpPort;
    xpPort = undefined;
    xpBundle = undefined;
    xpConnection?.disconnect();
    const connection = port;
    port = undefined;
    bundle = undefined;
    connection?.disconnect();
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
