import { DAY_MAP_JST, FALLBACK_AIRING_ANIME } from "./constants";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ANILIST_MEDIA_QUERY = `
query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
        id
        idMal
        status
        episodes
        nextAiringEpisode {
            airingAt
            episode
            timeUntilAiring
        }
        title {
            romaji
            english
            native
        }
        siteUrl
    }
}
`;

// FIXED: Added nextAiringEpisode query parameters to calculate dynamic local countdowns
const ANILIST_SEARCH_QUERY = `
query ($search: String) {
    Page(perPage: 6) {
        media(search: $search, type: ANIME) {
            id
            idMal
            title {
                romaji
                english
                native
            }
            status
            episodes
            coverImage {
                large
            }
            genres
            season
            seasonYear
            studios {
                nodes {
                    name
                }
            }
            siteUrl
            description
            trailer {
                id
                site
            }
            nextAiringEpisode {
                airingAt
                episode
            }
        }
    }
}
`;

export async function fetchWithRetry(
  url: string,
  options: {
    retries?: number;
    retryDelayMs?: number;
    retryStatuses?: number[];
  } = {},
): Promise<Response> {
  const {
    retries = 3,
    retryDelayMs = 1200,
    retryStatuses = [429, 503, 504],
  } = options;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok || !retryStatuses.includes(response.status)) {
        return response;
      }
      lastResponse = response;
      if (attempt < retries) {
        await delay(retryDelayMs * attempt);
      }
    } catch (error) {
      if (attempt >= retries) throw error;
      await delay(retryDelayMs * attempt);
    }
  }
  if (!lastResponse) throw new Error("Fetch failed completely");
  return lastResponse;
}

export async function fetchGraphqlWithRetry(
  url: string,
  body: any,
  options: {
    retries?: number;
    retryDelayMs?: number;
    retryStatuses?: number[];
  } = {},
): Promise<Response> {
  const {
    retries = 3,
    retryDelayMs = 1200,
    retryStatuses = [429, 503, 504],
  } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.ok || !retryStatuses.includes(response.status)) {
        return response;
      }
      if (attempt < retries) {
        await delay(retryDelayMs * attempt);
      }
    } catch (error) {
      if (attempt >= retries) throw error;
      await delay(retryDelayMs * attempt);
    }
  }
  throw new Error("GraphQL fetch failed");
}

export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resolveStudioName(show: any): string {
  if (show.studios?.length) {
    return show.studios.map((s: any) => s.name).join(", ");
  }
  if (typeof show.studio === "string" && show.studio) {
    return show.studio;
  }
  return "Unknown Studio";
}

export function normalizeAnimeStatus(
  status: string | undefined,
  fallbackAiring = false,
): string {
  if (
    status === "RELEASING" ||
    status === "Airing" ||
    status === "Currently Airing"
  )
    return "Currently Airing";
  if (
    status === "FINISHED" ||
    status === "Finished" ||
    status === "Finished Airing"
  )
    return "Finished Airing";
  if (status === "NOT_YET_RELEASED" || status === "Not yet aired") return "TBA";
  if (status === "CANCELLED" || status === "Cancelled") return "Cancelled";
  if (typeof status === "string" && status) return status;
  return fallbackAiring ? "Currently Airing" : "Finished Airing";
}

export function buildBroadcastFromAiringAt(airingAt: number) {
  const airingDate = new Date(airingAt * 1000);
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDay = airingDate.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: localTimeZone,
  });
  const localTime = airingDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: localTimeZone,
  });
  const jstDay = airingDate.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Asia/Tokyo",
  });
  const jstTime = airingDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: "Asia/Tokyo",
  });

  return {
    airingAt,
    day: localDay,
    time: localTime,
    timezone: localTimeZone,
    string: `${localDay}s at ${localTime}`,
    sourceString: `${jstDay}s at ${jstTime} (JST)`,
    sourceTimezone: "Asia/Tokyo",
  };
}

export async function fetchAniListMediaByMalId(malId: number) {
  const response = await fetchGraphqlWithRetry(
    "https://graphql.anilist.co",
    {
      query: ANILIST_MEDIA_QUERY,
      variables: { idMal: malId },
    },
    { retries: 3, retryDelayMs: 1000 },
  );

  if (!response.ok) {
    throw new Error(
      `AniList lookup failed (${response.status}) for MAL id ${malId}.`,
    );
  }

  const json = await response.json();
  return json.data?.Media || null;
}

export async function fetchAniListScheduleMap(malIds: number[]) {
  const scheduleMap: Record<number, any> = {};
  const uniqueIds = [...new Set(malIds)].filter(Boolean);

  const mediaList = await Promise.all(
    uniqueIds.map(async (malId) => {
      try {
        return await fetchAniListMediaByMalId(malId);
      } catch (error) {
        console.warn(`AniList lookup failed for MAL id ${malId}.`, error);
        return null;
      }
    }),
  );

  mediaList.forEach((media) => {
    if (!media) return;

    const airingEpisode = media.nextAiringEpisode || null;
    scheduleMap[media.idMal] = {
      mal_id: media.idMal,
      status: normalizeAnimeStatus(media.status, Boolean(airingEpisode)),
      airing: media.status === "RELEASING" || Boolean(airingEpisode),
      broadcast: airingEpisode
        ? buildBroadcastFromAiringAt(airingEpisode.airingAt)
        : null,
      next_airing_episode: airingEpisode?.episode || null,
      next_airing_at: airingEpisode?.airingAt || null,
      score: 0,
      episodes: media.episodes || 0,
      url: media.siteUrl || `https://anilist.co/anime/${media.id}`,
      title:
        media.title?.english ||
        media.title?.romaji ||
        media.title?.native ||
        "",
    };
  });

  return scheduleMap;
}

export function getUtcFromJst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+09:00`,
  ).getTime();
}

export function getJstComponents(date: Date = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const value = (type: string) => {
    const part = parts.find((p) => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };

  const weekdayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "long",
  })
    .format(date)
    .toLowerCase();

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    dayOfWeek: DAY_MAP_JST[weekdayStr],
  };
}

export function getJstOccurrenceUtc(
  broadcast: any,
  options: { next?: boolean; ignoreAiringAt?: boolean } = {},
): number | null {
  const { next = false, ignoreAiringAt = false } = options;

  if (!ignoreAiringAt && broadcast?.airingAt) {
    return broadcast.airingAt * 1000;
  }

  if (!broadcast || !broadcast.day || !broadcast.time) return null;

  const targetDay = DAY_MAP_JST[broadcast.day.toLowerCase()];
  if (targetDay === undefined) return null;

  const [targetHours, targetMinutes] = broadcast.time.split(":").map(Number);
  const jst = getJstComponents();

  let daysAhead = targetDay - jst.dayOfWeek;
  if (daysAhead < 0) daysAhead += 7;

  if (next) {
    if (daysAhead === 0) {
      const currentMinutes = jst.hour * 60 + jst.minute;
      const targetTotalMinutes = targetHours * 60 + targetMinutes;
      if (currentMinutes >= targetTotalMinutes) {
        daysAhead = 7;
      }
    }
  }

  const anchorUtc = getUtcFromJst(jst.year, jst.month, jst.day, 0, 0);
  const targetAnchor = new Date(anchorUtc + daysAhead * 86400000);
  const targetJst = getJstComponents(targetAnchor);

  return getUtcFromJst(
    targetJst.year,
    targetJst.month,
    targetJst.day,
    targetHours,
    targetMinutes,
  );
}

export async function fetchUserProfile(username: string) {
  const encodedUsername = encodeURIComponent(username);
  const fallbackProfile = {
    username: username,
    images: {
      webp: {
        image_url: `https://placehold.co/100x100?text=${encodeURIComponent(username.substring(0, 3).toUpperCase())}`,
      },
    },
    statistics: { anime: { watching: 0 } },
  };

  try {
    const profileRes = await fetchWithRetry(
      `https://api.jikan.moe/v4/users/${encodedUsername}`,
      { retries: 2, retryDelayMs: 1000 },
    );
    if (profileRes.ok) {
      const profileJson = await profileRes.json();
      if (profileJson && profileJson.data) {
        return profileJson.data;
      }
    }
  } catch (e) {
    console.warn("Unable to fetch user profile details:", e);
  }
  return fallbackProfile;
}

export function parseMalWatchingListMarkdown(
  markdown: string,
  username: string,
): any[] {
  const sectionStart = markdown.indexOf("CURRENTLY WATCHING");
  if (sectionStart === -1) {
    throw new Error(
      "Unable to read the MyAnimeList watching page for this user.",
    );
  }

  const sectionEnd = markdown.indexOf(
    "MyAnimeList.net is a property",
    sectionStart,
  );
  const section = markdown.slice(
    sectionStart,
    sectionEnd === -1 ? undefined : sectionEnd,
  );
  const rowPattern =
    /\|\s*\|\s*\d+\s*\|\s*\[!\[Image\s*\d+\]\((https?:\/\/cdn\.myanimelist\.net\/[^)]+)\)\]\((?:https?:\/\/)?myanimelist\.net\/anime\/(\d+)\/[^)]+\)\s*\|\s*\[([^\]]+)\]\((?:https?:\/\/)?myanimelist\.net\/anime\/\2\/[^)]+\)([\s\S]*?)\|\s*\[([\-\d]+)\]\([^)]+\)\s*\|\s*([A-Za-z ]+)\s*\|\s*\[([\-\d]+)\]\([^)]+\)\s*\/\s*([\-\d]+|-)\s*\|/g;

  const listItems = [];
  for (const match of section.matchAll(rowPattern)) {
    const imageUrl = match[1];
    const malId = Number(match[2]);
    const title = match[3].trim();
    const titleCell = match[4];
    const score = match[5] === "-" ? 0 : Number(match[5]);
    const airing = /\bAiring\b/.test(titleCell);
    const episodesWatched = match[7] === "-" ? 0 : Number(match[7]);
    const episodesTotal = match[8] === "-" ? 0 : Number(match[8]);

    listItems.push({
      anime: {
        mal_id: malId,
        title: title,
        title_english: title,
        images: { webp: { image_url: imageUrl } },
        status: airing ? "Currently Airing" : "Finished Airing",
        episodes: episodesTotal,
        score: score,
        url: `https://myanimelist.net/anime/${malId}`,
      },
      episodes_watched: episodesWatched,
      score: score,
    });
  }

  if (listItems.length === 0) {
    throw new Error(
      `No anime entries were found on the MyAnimeList watching page for ${username}.`,
    );
  }

  return listItems;
}

export async function fetchUserWatchingListFromMalJson(
  username: string,
): Promise<any[]> {
  const encodedUsername = encodeURIComponent(username);
  const targetUrl = `https://myanimelist.net/animelist/${encodedUsername}/load.json?status=1`;
  const proxiedUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

  const response = await fetch(proxiedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch MAL JSON list (${response.status})`);
  }

  const rawList: any[] = await response.json();

  return rawList.map((item: any) => {
    let highResPoster =
      item.anime_image_path || "https://placehold.co/300x450?text=Poster";
    if (highResPoster.includes("/r/")) {
      highResPoster = highResPoster.replace(/\/r\/\d+x\d+/, "");
      highResPoster = highResPoster.split("?")[0];
    }

    return {
      anime: {
        mal_id: item.anime_id,
        title: item.anime_title,
        title_english: item.anime_title,
        images: {
          webp: {
            image_url: highResPoster,
          },
        },
        status:
          item.anime_airing_status === 1
            ? "Currently Airing"
            : "Finished Airing",
        episodes: item.anime_num_episodes,
        score: item.score || 0,
        url: `https://myanimelist.net${item.anime_url}`,
      },
      episodes_watched: item.num_watched_episodes,
      score: item.score || 0,
    };
  });
}

export async function fetchUserWatchingListFromJikan(
  username: string,
): Promise<any[]> {
  const encodedUsername = encodeURIComponent(username);
  const animeListRes = await fetchWithRetry(
    `https://api.jikan.moe/v4/users/${encodedUsername}/animelist?status=watching&limit=100`,
    { retries: 3, retryDelayMs: 1500 },
  );
  if (!animeListRes.ok) {
    const err: any = new Error(
      `MyAnimeList API error (${animeListRes.status})`,
    );
    err.code =
      animeListRes.status === 404 ? "NOT_FOUND" : "TEMPORARY_UNAVAILABLE";
    throw err;
  }
  const animeListJson = await animeListRes.json();
  return animeListJson.data || [];
}

export async function fetchUserWatchingList(username: string): Promise<any[]> {
  try {
    console.log("Fetching via direct MAL JSON proxy...");
    return await fetchUserWatchingListFromMalJson(username);
  } catch (proxyError) {
    console.warn(
      "Direct MAL JSON fetch failed, falling back to Jican API...",
      proxyError,
    );
  }
  return fetchUserWatchingListFromJikan(username);
}

export async function fetchLiveWeeklySchedule(): Promise<any[]> {
  try {
    const scheduleRes = await fetch(
      `https://api.jikan.moe/v4/schedules?limit=100`,
    );
    if (scheduleRes.ok) {
      const scheduleJson = await scheduleRes.json();
      const airingShows = scheduleJson.data || [];
      if (airingShows.length > 0) {
        return mapJikanShowsToWatchlist(airingShows);
      }
    }
  } catch (err) {
    console.warn("API Exception. Loading offline backup...", err);
  }
  return [...FALLBACK_AIRING_ANIME];
}

export function mapJikanShowsToWatchlist(rawShows: any[]): any[] {
  return rawShows.map((show) => {
    const cachedProgress = getLocalProgress(show.mal_id, 0);
    return {
      mal_id: show.mal_id,
      title: show.title,
      title_english: show.title_english || show.title,
      image_url:
        show.images?.webp?.large_image_url ||
        show.images?.webp?.image_url ||
        "https://placehold.co/300x450?text=Poster",
      airing: show.status === "Currently Airing",
      status: show.status,
      episodes_total: show.episodes || 0,
      episodes_watched_mal: 0,
      episodes_watched_local: cachedProgress,
      score: show.score || 0,
      broadcast: show.broadcast,
      next_airing_episode: null,
      next_airing_at: null,
      synopsis: show.synopsis || "No description available.",
      studio: resolveStudioName(show),
      trailer_url: show.trailer?.url || "",
      genres: show.genres || [],
      season: show.season
        ? `${show.season.charAt(0).toUpperCase() + show.season.slice(1)} ${show.year || ""}`
        : "Airing",
      url: show.url,
    };
  });
}

// FIXED: Maps nextAiringEpisode from the Graphql payload to construct exact broadcast countdowns
export async function searchAnimeFromAniList(query: string): Promise<any[]> {
  const response = await fetchGraphqlWithRetry(
    "https://graphql.anilist.co",
    {
      query: ANILIST_SEARCH_QUERY,
      variables: { search: query },
    },
    { retries: 2, retryDelayMs: 1000 },
  );

  if (!response.ok) {
    throw new Error(`AniList Search failed with status ${response.status}`);
  }

  const json = await response.json();
  const results = json.data?.Page?.media || [];

  return results.map((item: any) => {
    // Dynamic countdown data extraction
    const airingEpisode = item.nextAiringEpisode || null;
    const broadcast = airingEpisode
      ? buildBroadcastFromAiringAt(airingEpisode.airingAt)
      : null;

    return {
      mal_id: item.idMal,
      title: item.title.english || item.title.romaji || item.title.native,
      title_english: item.title.english || item.title.romaji,
      images: {
        webp: {
          large_image_url: item.coverImage.large,
          image_url: item.coverImage.large,
        },
      },
      status: item.status,
      episodes: item.episodes,
      score: 0,
      broadcast: broadcast, // FIXED: dynamically mapped
      next_airing_episode: airingEpisode?.episode || null, // FIXED: mapped
      next_airing_at: airingEpisode?.airingAt || null, // FIXED: mapped
      synopsis: item.description,
      studios: item.studios?.nodes,
      trailer: {
        url:
          item.trailer?.site === "youtube"
            ? `https://www.youtube.com/watch?v=${item.trailer.id}`
            : "",
      },
      genres: item.genres?.map((g: string) => ({ name: g })) || [],
      season: item.season,
      year: item.seasonYear,
      url: item.siteUrl,
    };
  });
}

export function getLocalProgress(malId: number, fallbackVal: number): number {
  const cacheKey = "local_progress_cache";
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    if (cache[malId] !== undefined) {
      return cache[malId];
    }
  } catch (e) {
    console.error("Local storage progress retrieval failed:", e);
  }
  return fallbackVal;
}

export function setLocalProgress(malId: number, progressVal: number): void {
  const cacheKey = "local_progress_cache";
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    cache[malId] = progressVal;
    localStorage.setItem(cacheKey, JSON.stringify(cache));
  } catch (e) {
    console.error("Local storage progress save failed:", e);
  }
}

export function getNextAiringTimestamp(broadcast: any): number | null {
  if (broadcast?.airingAt && broadcast.airingAt * 1000 > Date.now()) {
    return broadcast.airingAt * 1000;
  }
  return getJstOccurrenceUtc(broadcast, { next: true, ignoreAiringAt: true });
}

export function getLocalAiringDay(broadcast: any): number | null {
  if (broadcast?.airingAt) {
    return new Date(broadcast.airingAt * 1000).getDay();
  }
  const targetUtcEpoch = getJstOccurrenceUtc(broadcast);
  if (targetUtcEpoch == null) return null;
  return new Date(targetUtcEpoch).getDay();
}

export function getLocalAiringTime(broadcast: any): string {
  if (broadcast?.airingAt) {
    return new Date(broadcast.airingAt * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (!broadcast || !broadcast.day || !broadcast.time) return "TBA";
  const targetUtcEpoch = getJstOccurrenceUtc(broadcast);
  if (targetUtcEpoch == null) return broadcast.time;
  return new Date(targetUtcEpoch).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
