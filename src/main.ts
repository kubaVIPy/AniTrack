import {
  fetchUserProfile,
  fetchUserWatchingList,
  fetchAniListScheduleMap,
  normalizeAnimeStatus,
  resolveStudioName,
  fetchLiveWeeklySchedule,
  searchAnimeFromAniList,
  getLocalProgress,
  setLocalProgress,
  getNextAiringTimestamp,
  getLocalAiringDay,
  getLocalAiringTime,
  escapeHtml,
} from "./api";
import { DAYS_OF_WEEK } from "./constants";

const GUEST_WATCHLIST_KEY = "guest_watchlist_data";

let animeWatchlist: any[] = [];
let currentSearchResults: any[] = [];

const activeFilters = {
  sort: "countdown",
  airingStatus: "all",
};
let activeTimerInterval: ReturnType<typeof setInterval> | null = null;
let watchlistLoadNotice = "";
let elements: Record<string, HTMLElement | null> = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDomElements();
  initApp();
});

function cacheDomElements() {
  elements = {
    loginView: document.getElementById("loginView"),
    dashboardView: document.getElementById("dashboardView"),
    malForm: document.getElementById("malForm"),
    usernameInput: document.getElementById("usernameInput"),
    demoBtn: document.getElementById("demoBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    userProfile: document.getElementById("userProfile"),
    loadingOverlay: document.getElementById("loadingOverlay"),
    loadingText: document.getElementById("loadingText"),
    calendarDaysGrid: document.getElementById("calendarDaysGrid"),
    animeGrid: document.getElementById("animeGrid"),
    watchlistEmptyState: document.getElementById("watchlistEmptyState"),
    totalAnimeCount: document.getElementById("totalAnimeCount"),
    totalBehindCount: document.getElementById("totalBehindCount"),
    currentTimeZone: document.getElementById("currentTimeZone"),
    sortSelect: document.getElementById("sortSelect"),
    airingFilter: document.getElementById("airingFilter"),
    detailsModal: document.getElementById("detailsModal"),
    closeModalBtn: document.getElementById("closeModalBtn"),
    modalPoster: document.getElementById("modalPoster"),
    modalStatusBadge: document.getElementById("modalStatusBadge"),
    modalScoreBadge: document.getElementById("modalScoreBadge"),
    modalScore: document.getElementById("modalScore"),
    modalTitle: document.getElementById("modalTitle"),
    modalTitleEnglish: document.getElementById("modalTitleEnglish"),
    modalBroadcast: document.getElementById("modalBroadcast"),
    modalStudio: document.getElementById("modalStudio"),
    modalEpisodes: document.getElementById("modalEpisodes"),
    modalSeason: document.getElementById("modalSeason"),
    modalSynopsis: document.getElementById("modalSynopsis"),
    modalGenres: document.getElementById("modalGenres"),
    modalTrailerBtn: document.getElementById("modalTrailerBtn"),
    modalMalLink: document.getElementById("modalMalLink"),

    // Guest UI Elements
    guestSearchArea: document.getElementById("guestSearchArea"),
    guestSearchInput: document.getElementById("guestSearchInput"),
    guestSearchBtn: document.getElementById("guestSearchBtn"),
    searchResultsContainer: document.getElementById("searchResultsContainer"),
  };
}

function initApp() {
  const timezoneStr = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (elements.currentTimeZone) {
    elements.currentTimeZone.textContent = `🌐 ${timezoneStr}`;
  }

  const savedUsername = localStorage.getItem("mal_username");
  const guestMode = localStorage.getItem("mal_guest_mode") === "true";

  if (savedUsername) {
    loadUserProfileAndWatchlist(savedUsername);
  } else if (guestMode) {
    loadGuestDashboard();
  } else {
    elements.loginView?.classList.remove("hidden");
  }

  elements.malForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const inputVal = (
      elements.usernameInput as HTMLInputElement | null
    )?.value.trim();
    if (inputVal) {
      localStorage.removeItem("mal_guest_mode");
      loadUserProfileAndWatchlist(inputVal);
    }
  });

  elements.demoBtn?.addEventListener("click", () => {
    localStorage.setItem("mal_guest_mode", "true");
    localStorage.removeItem("mal_username");
    loadGuestDashboard();
  });

  elements.logoutBtn?.addEventListener("click", () => {
    localStorage.removeItem("mal_username");
    localStorage.removeItem("mal_guest_mode");

    elements.dashboardView?.classList.add("hidden");
    elements.guestSearchArea?.classList.add("hidden");
    elements.loginView?.classList.remove("hidden");

    if (activeTimerInterval) clearInterval(activeTimerInterval);
    animeWatchlist = [];
  });

  elements.closeModalBtn?.addEventListener("click", () => {
    elements.detailsModal?.classList.add("hidden");
  });

  // Safely narrow elements.detailsModal using local const
  const detailsModal = elements.detailsModal;
  if (detailsModal) {
    detailsModal.addEventListener("click", (e) => {
      if (e.target === detailsModal) {
        detailsModal.classList.add("hidden");
      }
    });
  }

  elements.sortSelect?.addEventListener("change", (e) => {
    activeFilters.sort = (e.target as HTMLSelectElement).value;
    renderWatchlist();
  });

  elements.airingFilter?.addEventListener("change", (e) => {
    activeFilters.airingStatus = (e.target as HTMLSelectElement).value;
    renderWatchlist();
  });

  // Wire up Guest Search Handlers
  elements.guestSearchBtn?.addEventListener("click", executeGuestSearch);
  elements.guestSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") executeGuestSearch();
  });
}

function showLoading(text: string) {
  if (elements.loadingText && elements.loadingOverlay) {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.remove("hidden");
  }
}

function hideLoading() {
  elements.loadingOverlay?.classList.add("hidden");
}

async function executeGuestSearch() {
  const queryInput = elements.guestSearchInput as HTMLInputElement | null;
  const container = elements.searchResultsContainer;
  if (!queryInput || !container) return;

  const query = queryInput.value.trim();
  if (!query) return;

  showLoading(`Searching AniList for "${query}"...`);
  try {
    const results = await searchAnimeFromAniList(query);
    currentSearchResults = results;
    container.innerHTML = "";

    if (results.length === 0) {
      container.innerHTML = `<div class="col-span-2 text-center text-slate-500 text-xs py-4">No matching results found</div>`;
    } else {
      results.forEach((show, index) => {
        const row = document.createElement("div");
        row.className =
          "flex items-center justify-between p-3 bg-slate-900 border border-darkBorder rounded-xl gap-3";

        const showTitle = show.title_english || show.title;
        const poster =
          show.images?.webp?.small_image_url ||
          show.images?.webp?.image_url ||
          "";

        const escapedTitle = escapeHtml(show.title).replace(/'/g, "\\'");
        const escapedStudio = escapeHtml(resolveStudioName(show)).replace(
          /'/g,
          "\\'",
        );

        row.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        <img src="${escapeHtml(poster)}" class="w-8 h-11 object-cover rounded pointer-events-none" alt="Cover">
                        <div class="min-w-0">
                            <div class="text-xs font-bold text-white truncate leading-snug">${escapeHtml(showTitle)}</div>
                            <div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(show.status)} · ${show.episodes || "Unknown"} ep</div>
                        </div>
                    </div>
                    <button onclick="addSearchedAnimeByIndex(${index})" class="bg-brand-500 hover:bg-brand-600 px-3.5 py-1.5 rounded-lg text-[10px] font-black transition-all flex-shrink-0 text-white">Add</button>
                `;
        container.appendChild(row);
      });
    }
    container.classList.remove("hidden");
  } catch (e: any) {
    alert(`Search Error: ${e.message}`);
  } finally {
    hideLoading();
  }
}

async function loadUserProfileAndWatchlist(username: string) {
  showLoading(`Syncing with MyAnimeList for '${username}'...`);
  try {
    const profileData = await fetchUserProfile(username);
    renderUserHeader({
      username: profileData.username || username,
      avatar: profileData.images?.webp?.image_url || "",
      watchingCount: profileData.statistics?.anime?.watching || 0,
    });

    let malList;
    try {
      malList = await fetchUserWatchingList(username);
      watchlistLoadNotice = "";
    } catch (err: any) {
      if (err?.code === "TEMPORARY_UNAVAILABLE") {
        animeWatchlist = [];
        watchlistLoadNotice = err.message;
        localStorage.setItem("mal_username", username);
        elements.loginView?.classList.add("hidden");
        elements.dashboardView?.classList.remove("hidden");
        renderWatchlist();
        startCountdownLoop();
        return;
      }
      throw err;
    }

    showLoading("Generating localized timezone calendars...");
    const anilistScheduleMap = await fetchAniListScheduleMap(
      malList.map((item) => item.anime?.mal_id),
    );

    const enrichedList: any[] = [];
    malList.forEach((item) => {
      const baseAnime = item.anime;
      const cachedProgress = getLocalProgress(
        baseAnime.mal_id,
        item.episodes_watched,
      );
      const scheduledShow = anilistScheduleMap[baseAnime.mal_id];

      let broadcast = baseAnime.broadcast || null;
      let synopsis = baseAnime.synopsis || "";
      let studioText = "Unknown Studio";
      let trailerUrl = "";
      let score = baseAnime.score || item.score || 0;
      let genres = [];
      let status = baseAnime.status;

      if (scheduledShow) {
        broadcast = scheduledShow.broadcast || broadcast;
        synopsis = scheduledShow.synopsis || synopsis;
        studioText = resolveStudioName(scheduledShow);
        trailerUrl = scheduledShow.trailer?.url || "";
        score = scheduledShow.score || score;
        genres = scheduledShow.genres || [];
        status = scheduledShow.status || status;
      }

      const normalizedStatus = normalizeAnimeStatus(status, Boolean(broadcast));

      enrichedList.push({
        mal_id: baseAnime.mal_id,
        title: baseAnime.title,
        title_english: baseAnime.title_english || baseAnime.title,
        image_url:
          baseAnime.images?.webp?.large_image_url ||
          baseAnime.images?.webp?.image_url ||
          "",
        airing: normalizedStatus === "Currently Airing",
        status: normalizedStatus,
        episodes_total: baseAnime.episodes || scheduledShow?.episodes || 0,
        episodes_watched_mal: item.episodes_watched,
        episodes_watched_local: cachedProgress,
        score: score,
        broadcast: broadcast,
        synopsis: synopsis,
        studio: studioText,
        trailer_url: trailerUrl,
        genres: genres,
        season: baseAnime.season
          ? `${baseAnime.season.charAt(0).toUpperCase() + baseAnime.season.slice(1)} ${baseAnime.year || ""}`
          : "TBA",
        url: baseAnime.url,
        next_airing_episode: scheduledShow?.next_airing_episode || null,
        next_airing_at: scheduledShow?.next_airing_at || null,
      });
    });

    animeWatchlist = enrichedList;
    localStorage.setItem("mal_username", username);

    renderUserHeader({
      username: profileData.username || username,
      avatar: profileData.images?.webp?.image_url || "",
      watchingCount: enrichedList.length,
    });

    elements.loginView?.classList.add("hidden");
    elements.guestSearchArea?.classList.add("hidden");
    elements.dashboardView?.classList.remove("hidden");

    renderWatchlist();
    startCountdownLoop();
  } catch (err: any) {
    alert(`Unable to load data: ${err.message}`);
  } finally {
    hideLoading();
  }
}

async function loadGuestDashboard() {
  showLoading("Loading Guest Watchlist...");
  try {
    const savedList = localStorage.getItem(GUEST_WATCHLIST_KEY);
    if (savedList) {
      animeWatchlist = JSON.parse(savedList);
    } else {
      const rawSchedule = await fetchLiveWeeklySchedule();
      animeWatchlist = rawSchedule.slice(0, 4);
      localStorage.setItem(GUEST_WATCHLIST_KEY, JSON.stringify(animeWatchlist));
    }

    renderUserHeader({
      username: "Guest Watcher",
      avatar: "https://placehold.co/100x100?text=Guest",
      watchingCount: animeWatchlist.length,
    });

    elements.guestSearchArea?.classList.remove("hidden");
    elements.loginView?.classList.add("hidden");
    elements.dashboardView?.classList.remove("hidden");

    renderWatchlist();
    startCountdownLoop();
  } catch (err: any) {
    alert(`Critical Loading Error: ${err.message}`);
  } finally {
    hideLoading();
  }
}

function renderUserHeader({ username, avatar, watchingCount }: any) {
  if (elements.userProfile) {
    elements.userProfile.innerHTML = `
            <img class="h-9 w-9 rounded-full ring-2 ring-brand-500 bg-slate-900 object-cover" src="${escapeHtml(avatar)}" alt="Avatar">
            <div class="hidden sm:block">
                <div class="text-sm font-extrabold text-white leading-none">${escapeHtml(username)}</div>
                <div class="text-[10px] text-slate-400 mt-0.5">${watchingCount} Currently Tracking</div>
            </div>
        `;
  }
}

function getReleasedEpisodes(anime: any): number {
  const totalEpisodes = Number(anime.episodes_total) || 0;
  const watchedFallback = Math.max(
    Number(anime.episodes_watched_mal) || 0,
    Number(anime.episodes_watched_local) || 0,
    0,
  );

  if (!anime.airing) {
    return totalEpisodes > 0 ? totalEpisodes : watchedFallback;
  }

  const nextEpisodeNumber = Number(anime.next_airing_episode) || 0;
  if (nextEpisodeNumber > 0) {
    const nextAiringAt = Number(anime.next_airing_at) || 0;
    if (nextAiringAt > 0 && nextAiringAt * 1000 <= Date.now()) {
      return nextEpisodeNumber;
    }
    return Math.max(nextEpisodeNumber - 1, 0);
  }
  return watchedFallback;
}

function getBehindEpisodes(anime: any): number {
  const watchedEpisodes = Number(anime.episodes_watched_local) || 0;
  const releasedEpisodes = getReleasedEpisodes(anime);
  return Math.max(releasedEpisodes - watchedEpisodes, 0);
}

function getBehindIndicatorData(anime: any) {
  const behindEpisodes = getBehindEpisodes(anime);
  if (behindEpisodes <= 0) {
    return {
      text: "✅ Up to date",
      className: "text-[10px] font-extrabold text-emerald-400",
    };
  }
  return {
    text: `⚠️ ${behindEpisodes} ep behind`,
    className: "text-[10px] font-extrabold text-rose-400",
  };
}

function updateBehindSummary(list = animeWatchlist) {
  if (!elements.totalBehindCount) return;
  const totalBehind = list.reduce(
    (sum, anime) => sum + getBehindEpisodes(anime),
    0,
  );
  elements.totalBehindCount.textContent = `Behind by ${totalBehind} episode${totalBehind === 1 ? "" : "s"}`;
}

function updateGuestStats() {
  const statsBar = document.getElementById("guestStatsBar");
  if (!statsBar) return;

  const isGuest = localStorage.getItem("mal_guest_mode") === "true";
  if (!isGuest) {
    statsBar.classList.add("hidden");
    return;
  }

  statsBar.classList.remove("hidden");

  const trackedEl = document.getElementById("statTrackedCount");
  const watchedEl = document.getElementById("statWatchedCount");
  const completedEl = document.getElementById("statCompletedCount");

  if (trackedEl) trackedEl.textContent = String(animeWatchlist.length);

  const totalWatched = animeWatchlist.reduce(
    (sum, a) => sum + (a.episodes_watched_local || 0),
    0,
  );
  if (watchedEl) watchedEl.textContent = String(totalWatched);

  const completedCount = animeWatchlist.filter((a) => {
    return a.episodes_total > 0 && a.episodes_watched_local >= a.episodes_total;
  }).length;
  if (completedEl) completedEl.textContent = String(completedCount);
}

function renderCalendar() {
  const calendarGrid = elements.calendarDaysGrid;
  if (!calendarGrid) return;
  calendarGrid.innerHTML = "";

  const todayIndex = new Date().getDay();
  const weekDaysOrdered = [1, 2, 3, 4, 5, 6, 0];

  weekDaysOrdered.forEach((dayNum) => {
    const dayName = DAYS_OF_WEEK[dayNum];
    const isToday = todayIndex === dayNum;

    const airingTodayAnime = animeWatchlist.filter((anime) => {
      if (!anime.airing || !anime.broadcast || !anime.broadcast.day)
        return false;
      const calculatedLocalDay = getLocalAiringDay(anime.broadcast);
      return calculatedLocalDay === dayNum;
    });

    const dayCard = document.createElement("div");
    const bgStyles = isToday
      ? "border-brand-500/40 bg-gradient-to-b from-brand-500/10 to-darkCard"
      : "border-darkBorder bg-darkCard/10";

    let animeRowsHtml = "";
    if (airingTodayAnime.length === 0) {
      animeRowsHtml = `<div class="text-[10px] text-slate-500 italic py-2">Nothing airing</div>`;
    } else {
      airingTodayAnime.forEach((anime) => {
        const localTimeStr = getLocalAiringTime(anime.broadcast);
        animeRowsHtml += `
                    <button onclick="openAnimeDetails(${anime.mal_id})" class="w-full text-left p-2 rounded-xl bg-darkBg/60 border border-darkBorder hover:border-brand-500 hover:bg-brand-500/5 transition-all flex items-center gap-2 mt-2 group">
                        <img src="${escapeHtml(anime.image_url)}" class="w-7 h-9 rounded object-cover flex-shrink-0" alt="Cover">
                        <div class="min-w-0">
                            <div class="text-[11px] font-bold text-slate-200 truncate leading-snug group-hover:text-brand-400 transition-colors">
                                ${escapeHtml(anime.title)}
                            </div>
                            <div class="text-[9px] text-cyan-400 mt-0.5">⏰ ${escapeHtml(localTimeStr)}</div>
                        </div>
                    </button>
                `;
      });
    }

    dayCard.className = `p-4 rounded-2xl border ${bgStyles} flex flex-col justify-between transition-all`;
    dayCard.innerHTML = `
            <div>
                <div class="flex items-center justify-between">
                    <span class="text-xs font-extrabold uppercase tracking-wider ${isToday ? "text-brand-400" : "text-slate-400"}">${dayName.substring(0, 3)}</span>
                    ${isToday ? `<span class="text-[9px] bg-brand-500 text-white px-2 py-0.5 rounded-full font-black uppercase">Today</span>` : ""}
                </div>
                <div class="mt-2">${animeRowsHtml}</div>
            </div>
        `;
    calendarGrid.appendChild(dayCard);
  });
}

function renderWatchlist() {
  renderCalendar();
  updateGuestStats();

  const animeGrid = elements.animeGrid;
  if (!animeGrid) return;

  let filteredList = [...animeWatchlist];

  if (activeFilters.airingStatus === "airing") {
    filteredList = filteredList.filter((a) => a.airing);
  } else if (activeFilters.airingStatus === "finished") {
    filteredList = filteredList.filter((a) => !a.airing);
  }

  if (activeFilters.sort === "countdown") {
    filteredList.sort((a, b) => {
      if (!a.airing && b.airing) return 1;
      if (a.airing && !b.airing) return -1;
      if (!a.airing && !b.airing) return 0;
      const aTime = getNextAiringTimestamp(a.broadcast) || Infinity;
      const bTime = getNextAiringTimestamp(b.broadcast) || Infinity;
      return aTime - bTime;
    });
  } else if (activeFilters.sort === "score") {
    filteredList.sort((a, b) => b.score - a.score);
  } else if (activeFilters.sort === "title") {
    filteredList.sort((a, b) => a.title.localeCompare(b.title));
  } else if (activeFilters.sort === "progress") {
    filteredList.sort((a, b) => {
      const behindDiff = getBehindEpisodes(b) - getBehindEpisodes(a);
      if (behindDiff !== 0) return behindDiff;
      const aTime = getNextAiringTimestamp(a.broadcast) || Infinity;
      const bTime = getNextAiringTimestamp(b.broadcast) || Infinity;
      return aTime - bTime;
    });
  }

  if (elements.totalAnimeCount) {
    elements.totalAnimeCount.textContent = `${filteredList.length} of ${animeWatchlist.length} anime matched`;
  }
  updateBehindSummary(filteredList);

  if (filteredList.length === 0) {
    animeGrid.innerHTML = "";
    elements.watchlistEmptyState?.classList.remove("hidden");
    return;
  }

  elements.watchlistEmptyState?.classList.add("hidden");
  animeGrid.innerHTML = "";

  const isGuestMode = localStorage.getItem("mal_guest_mode") === "true";

  filteredList.forEach((anime) => {
    const card = document.createElement("div");
    card.className =
      "flex flex-col rounded-2xl border border-darkBorder bg-darkCard/50 backdrop-blur-md overflow-hidden hover:border-brand-500/30 hover:shadow-lg transition-all duration-300 relative group";

    const watched = anime.episodes_watched_local;
    const total = anime.episodes_total;
    const percentage = total > 0 ? Math.min((watched / total) * 100, 100) : 0;
    const behindIndicator = getBehindIndicatorData(anime);

    const hasBroadcast =
      anime.broadcast &&
      anime.broadcast.string &&
      !anime.broadcast.string.toLowerCase().includes("tba");
    const broadcastHtml = hasBroadcast
      ? `<div class="text-[11px] text-cyan-400 font-bold mt-1.5 flex items-center gap-1">📅 <span>${escapeHtml(anime.broadcast.string)}</span></div>`
      : "";

    const totalText = total > 0 ? `${total} ep` : "? ep";

    let middleBoxHtml = "";
    if (anime.airing && anime.broadcast?.day) {
      middleBoxHtml = `
                <div class="mt-3 p-3 bg-darkBg/60 border border-darkBorder rounded-xl min-h-[3.75rem] flex flex-col justify-center">
                    <span class="text-[9px] text-slate-500 uppercase tracking-wider font-extrabold">Next Episode</span>
                    <div id="countdown-timer-${anime.mal_id}" class="text-xs font-black text-white tracking-wide mt-0.5">Calculating...</div>
                </div>
            `;
    } else {
      const genresHtml =
        anime.genres && anime.genres.length > 0
          ? `<div class="flex flex-wrap gap-1 mt-1">${anime.genres
              .slice(0, 2)
              .map(
                (g: any) =>
                  `<span class="text-[9px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-semibold">${escapeHtml(g.name || g)}</span>`,
              )
              .join("")}</div>`
          : "";
      const studioText =
        anime.studio && anime.studio !== "Unknown Studio"
          ? escapeHtml(anime.studio)
          : "TBA";

      middleBoxHtml = `
                <div class="mt-3 p-3 bg-darkBg/30 border border-darkBorder/60 rounded-xl min-h-[3.75rem] flex flex-col justify-center">
                    <span class="text-[9px] text-slate-500 uppercase tracking-wider font-extrabold">Studio</span>
                    <div class="text-xs font-extrabold text-slate-300 truncate">🎬 ${studioText}</div>
                    ${genresHtml}
                </div>
            `;
    }

    const removeButtonHtml = isGuestMode
      ? `<button onclick="removeAnime(${anime.mal_id})" class="absolute top-3 right-3 p-2 bg-slate-950/80 hover:bg-rose-600 hover:text-white text-rose-400 rounded-md transition-all z-10" title="Remove from Watchlist">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
               </button>`
      : "";

    // CONDITIONAL CONTROLS LAYOUT: Interactive only for Guest Mode, plain text for MAL Sync
    let progressControlsHtml = "";
    if (isGuestMode) {
      progressControlsHtml = `
                <div class="flex items-center justify-between gap-2 bg-slate-900/40 p-2 rounded-xl border border-darkBorder/40">
                    <div class="text-xs font-bold text-slate-400 px-1">
                        Watched: <span id="progress-text-${anime.mal_id}" class="text-white font-extrabold">${watched}</span> / ${totalText}
                    </div>
                    <div class="flex gap-1.5">
                        <button onclick="decrementProgress(${anime.mal_id}, ${total})" class="w-8 h-8 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-lg font-black text-xs transition-all flex items-center justify-center shadow-md" title="Decrease Progress">
                            <span>-1</span>
                        </button>
                        <button onclick="incrementProgress(${anime.mal_id}, ${total})" class="w-8 h-8 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white rounded-lg font-black text-xs transition-all flex items-center justify-center shadow-md shadow-brand-500/10" title="Increase Progress">
                            <span>+1</span>
                        </button>
                    </div>
                </div>
            `;
    } else {
      progressControlsHtml = `
                <div class="flex items-center justify-between text-xs font-bold text-slate-400 px-1">
                    <span>Watched: <span id="progress-text-${anime.mal_id}" class="text-white font-extrabold">${watched}</span> / ${totalText}</span>
                </div>
            `;
    }

    card.innerHTML = `
            <div class="h-40 relative overflow-hidden bg-slate-950 cursor-pointer">
                <div onclick="openAnimeDetails(${anime.mal_id})" class="absolute inset-0">
                    <img src="${escapeHtml(anime.image_url)}" alt="${escapeHtml(anime.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                    <div class="absolute inset-0 bg-gradient-to-t from-darkCard via-transparent to-transparent"></div>
                </div>
                ${removeButtonHtml}
                <div class="absolute top-3 left-3 flex flex-wrap gap-1.5 pointer-events-none">
                    <span class="text-[9px] font-black px-2.5 py-1 rounded-md tracking-wider uppercase ${anime.airing ? "bg-emerald-500 text-white" : "bg-slate-700 text-slate-300"}">
                        ${escapeHtml(anime.airing ? "AIRING" : anime.status)}
                    </span>
                    ${
                      anime.score
                        ? `
                        <span class="text-[9px] font-black px-2.5 py-1 rounded-md tracking-wider bg-yellow-500 text-slate-950">
                            ⭐ ${anime.score.toFixed(1)}
                        </span>
                    `
                        : ""
                    }
                </div>
            </div>
            <div class="p-4 flex-1 flex flex-col justify-between">
                <div>
                    <h3 onclick="openAnimeDetails(${anime.mal_id})" class="font-extrabold text-sm text-slate-100 line-clamp-1 hover:text-brand-400 cursor-pointer" title="${escapeHtml(anime.title)}">${escapeHtml(anime.title)}</h3>
                    ${broadcastHtml}
                    ${middleBoxHtml}
                </div>
                <div class="mt-3 border-t border-darkBorder/40 pt-3 space-y-2">
                    ${progressControlsHtml}
                    <div class="w-full bg-slate-900 rounded-full h-1 border border-darkBorder overflow-hidden">
                        <div id="progress-bar-${anime.mal_id}" class="bg-gradient-to-r from-brand-500 to-cyan-500 h-1 rounded-full" style="width: ${percentage}%"></div>
                    </div>
                    <div id="behind-text-${anime.mal_id}" class="${behindIndicator.className}">${behindIndicator.text}</div>
                </div>
            </div>
        `;
    animeGrid.appendChild(card);
  });
  updateAllTimers();
}

function startCountdownLoop() {
  if (activeTimerInterval) clearInterval(activeTimerInterval);
  activeTimerInterval = setInterval(updateAllTimers, 1000);
}

function updateAllTimers() {
  animeWatchlist.forEach((anime) => {
    if (!anime.airing || !anime.broadcast || !anime.broadcast.day) return;
    const timerEl = document.getElementById(`countdown-timer-${anime.mal_id}`);
    if (!timerEl) return;

    const nextAiringEpoch = getNextAiringTimestamp(anime.broadcast);
    if (!nextAiringEpoch) {
      timerEl.textContent = "Schedule Pending...";
      return;
    }

    const diff = nextAiringEpoch - Date.now();
    if (diff <= 0) {
      timerEl.innerHTML = `<span class="text-emerald-400">Airing Now</span>`;
    } else {
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      let formatted = "";
      if (days > 0) formatted += `${days}d `;
      formatted += `${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
      timerEl.textContent = formatted;
    }
  });
}

export function incrementProgress(malId: number, totalEpisodes: number) {
  const anime = animeWatchlist.find((a) => a.mal_id === malId);
  if (!anime) return;

  let currentWatched = getLocalProgress(malId, anime.episodes_watched_mal);
  currentWatched += 1;

  if (totalEpisodes > 0 && currentWatched > totalEpisodes) {
    currentWatched = 0;
  }

  anime.episodes_watched_local = currentWatched;
  setLocalProgress(malId, currentWatched);

  const isGuest = localStorage.getItem("mal_guest_mode") === "true";
  if (isGuest) {
    localStorage.setItem(GUEST_WATCHLIST_KEY, JSON.stringify(animeWatchlist));
  }

  const textEl = document.getElementById(`progress-text-${malId}`);
  const barEl = document.getElementById(`progress-bar-${malId}`);

  if (textEl) textEl.textContent = String(currentWatched);
  if (barEl) {
    const percentage =
      totalEpisodes > 0
        ? Math.min((currentWatched / totalEpisodes) * 100, 100)
        : 0;
    barEl.style.width = `${percentage}%`;
  }

  const indicatorEl = document.getElementById(`behind-text-${malId}`);
  if (indicatorEl) {
    const indicator = getBehindIndicatorData(anime);
    indicatorEl.className = indicator.className;
    indicatorEl.textContent = indicator.text;
  }
  updateBehindSummary();
  updateGuestStats();
  showMiniToast(`Watched ep ${currentWatched}`);
}

export function decrementProgress(malId: number, totalEpisodes: number) {
  const anime = animeWatchlist.find((a) => a.mal_id === malId);
  if (!anime) return;

  let currentWatched = getLocalProgress(malId, anime.episodes_watched_mal);
  currentWatched -= 1;

  if (currentWatched < 0) {
    currentWatched = 0;
  }

  anime.episodes_watched_local = currentWatched;
  setLocalProgress(malId, currentWatched);

  const isGuest = localStorage.getItem("mal_guest_mode") === "true";
  if (isGuest) {
    localStorage.setItem(GUEST_WATCHLIST_KEY, JSON.stringify(animeWatchlist));
  }

  const textEl = document.getElementById(`progress-text-${malId}`);
  const barEl = document.getElementById(`progress-bar-${malId}`);

  if (textEl) textEl.textContent = String(currentWatched);
  if (barEl) {
    const percentage =
      totalEpisodes > 0
        ? Math.min((currentWatched / totalEpisodes) * 100, 100)
        : 0;
    barEl.style.width = `${percentage}%`;
  }

  const indicatorEl = document.getElementById(`behind-text-${malId}`);
  if (indicatorEl) {
    const indicator = getBehindIndicatorData(anime);
    indicatorEl.className = indicator.className;
    indicatorEl.textContent = indicator.text;
  }
  updateBehindSummary();
  updateGuestStats();
  showMiniToast(`Watched ep ${currentWatched}`);
}

export function addSearchedAnimeByIndex(index: number) {
  const show = currentSearchResults[index];
  if (!show) return;

  const alreadyExists = animeWatchlist.some((a) => a.mal_id === show.mal_id);
  if (alreadyExists) {
    showMiniToast("Anime is already in your watchlist!");
    return;
  }

  const newAnime = {
    mal_id: show.mal_id,
    title: show.title,
    title_english: show.title,
    image_url:
      show.images?.webp?.large_image_url ||
      show.images?.webp?.image_url ||
      "https://placehold.co/300x450?text=Poster",
    airing: show.status === "RELEASING" || show.status === "Airing",
    status: normalizeAnimeStatus(show.status, true),
    episodes_total: show.episodes || 0,
    episodes_watched_mal: 0,
    episodes_watched_local: 0,
    score: show.score || 0,
    broadcast: show.broadcast || null,
    synopsis: show.synopsis || "No description available.",
    studio: resolveStudioName(show),
    trailer_url: show.trailer?.url || "",
    genres: show.genres || [],
    season: show.season
      ? `${show.season.charAt(0).toUpperCase() + show.season.slice(1)} ${show.year || ""}`
      : "Added",
    url: show.url || `https://myanimelist.net/anime/${show.mal_id}`,
    next_airing_episode: show.next_airing_episode || null, // ADDED
    next_airing_at: show.next_airing_at || null, // ADDED
  };

  animeWatchlist.unshift(newAnime);
  localStorage.setItem(GUEST_WATCHLIST_KEY, JSON.stringify(animeWatchlist));

  if (elements.guestSearchInput)
    (elements.guestSearchInput as HTMLInputElement).value = "";
  if (elements.searchResultsContainer) {
    elements.searchResultsContainer.innerHTML = "";
    elements.searchResultsContainer.classList.add("hidden");
  }

  renderUserHeader({
    username: "Guest Watcher",
    avatar: "https://placehold.co/100x100?text=Guest",
    watchingCount: animeWatchlist.length,
  });

  renderWatchlist();
  showMiniToast(`Added "${newAnime.title}"!`);
}

export function removeAnime(malId: number) {
  animeWatchlist = animeWatchlist.filter((a) => a.mal_id !== malId);
  localStorage.setItem(GUEST_WATCHLIST_KEY, JSON.stringify(animeWatchlist));

  renderUserHeader({
    username: "Guest Watcher",
    avatar: "https://placehold.co/100x100?text=Guest",
    watchingCount: animeWatchlist.length,
  });

  renderWatchlist();
  showMiniToast("Anime removed from watchlist.");
}

function showMiniToast(message: string) {
  const toast = document.createElement("div");
  toast.className =
    "fixed bottom-5 right-5 bg-gradient-to-r from-brand-600 to-indigo-600 text-white font-semibold text-xs py-3 px-5 rounded-xl shadow-2xl z-50 border border-brand-500/30 transition-all duration-300 transform translate-y-10 opacity-0";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("translate-y-10", "opacity-0");
  }, 10);

  setTimeout(() => {
    toast.classList.add("translate-y-10", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

export function openAnimeDetails(malId: number) {
  const anime = animeWatchlist.find((a) => a.mal_id === malId);
  if (!anime) return;

  if (elements.modalPoster) {
    (elements.modalPoster as HTMLImageElement).src = anime.image_url;
  }
  if (elements.modalTitle) {
    elements.modalTitle.textContent = anime.title;
  }
  if (elements.modalTitleEnglish) {
    elements.modalTitleEnglish.textContent =
      anime.title_english !== anime.title ? anime.title_english : "";
  }
  if (elements.modalScore) {
    elements.modalScore.textContent = anime.score
      ? anime.score.toFixed(2)
      : "N/A";
  }
  if (elements.modalBroadcast) {
    elements.modalBroadcast.textContent = anime.broadcast?.string || "TBA";
  }
  if (elements.modalStudio) {
    elements.modalStudio.textContent = anime.studio;
  }
  if (elements.modalEpisodes) {
    elements.modalEpisodes.textContent = `${anime.episodes_total || "∞"} episodes`;
  }
  if (elements.modalSeason) {
    elements.modalSeason.textContent = anime.season;
  }
  if (elements.modalSynopsis) {
    elements.modalSynopsis.textContent =
      anime.synopsis || "No synopsis available.";
  }

  if (elements.modalStatusBadge) {
    elements.modalStatusBadge.textContent = anime.status;
    if (anime.airing) {
      elements.modalStatusBadge.className =
        "inline-block text-[9px] font-black px-2.5 py-1 rounded-full mb-3 bg-emerald-500 text-white";
    } else {
      elements.modalStatusBadge.className =
        "inline-block text-[9px] font-black px-2.5 py-1 rounded-full mb-3 bg-slate-700 text-slate-300";
    }
  }

  if (elements.modalGenres) {
    elements.modalGenres.innerHTML = "";
    if (anime.genres && anime.genres.length > 0) {
      anime.genres.forEach((genre: any) => {
        const span = document.createElement("span");
        span.className =
          "text-[10px] bg-slate-800 text-slate-300 px-2 py-1 rounded-lg font-semibold border border-darkBorder";
        span.textContent = genre.name || genre;
        elements.modalGenres?.appendChild(span);
      });
    } else {
      elements.modalGenres.innerHTML = `<span class="text-xs text-slate-500">No genres listed</span>`;
    }
  }

  elements.detailsModal?.classList.remove("hidden");
}

(window as any).openAnimeDetails = openAnimeDetails;
(window as any).incrementProgress = incrementProgress;
(window as any).decrementProgress = decrementProgress;
(window as any).addSearchedAnimeByIndex = addSearchedAnimeByIndex;
(window as any).removeAnime = removeAnime;
