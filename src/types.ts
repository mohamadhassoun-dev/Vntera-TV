// ---------------------------------------------------------------------------
// Vntera domain model
// Raw Xtream/OTT panel payloads plus the normalized catalog the UI consumes.
// ---------------------------------------------------------------------------

export type Quality = '4K' | 'FHD' | 'HD' | 'SD'
export type MediaKind = 'live' | 'movie' | 'series'
export type Provider =
  | 'netflix'
  | 'prime'
  | 'shahid'
  | 'disney'
  | 'wwe'
  | 'apple'
  | 'hbo'
  | 'osn'
  | 'other'

export interface UserInfo {
  username: string
  password?: string
  auth?: number
  status?: string
  exp_date?: string | null
  is_trial?: string | number
  active_cons?: string | number
  created_at?: string | number
  max_connections?: string | number
  allowed_output_formats?: string[]
  message?: string
}

export interface ServerInfo {
  url?: string
  port?: string
  https_port?: string
  server_protocol?: string
  timezone?: string
  time_now?: string
  timestamp_now?: number
}

export interface AuthSession {
  username: string
  server: string
  userInfo: UserInfo
  serverInfo: ServerInfo
  loggedInAt: number
  demo?: boolean
  deviceId: string
}

export interface RawCategory {
  category_id: string
  category_name: string
  parent_id?: number
}

export interface RawLiveStream {
  num?: number
  name: string
  stream_type?: string
  stream_id: number
  stream_icon?: string
  epg_channel_id?: string
  added?: string
  category_id?: string
  custom_sid?: string
  tv_archive?: number
  direct_source?: string
  tv_archive_duration?: number
}

export interface RawVodStream {
  num?: number
  name: string
  stream_type?: string
  stream_id: number
  stream_icon?: string
  rating?: string
  rating_5based?: number
  added?: string
  category_id?: string
  container_extension?: string
  custom_sid?: string
  direct_source?: string
  year?: string | number
}

export interface VodInfo {
  info?: {
    movie_image?: string
    backdrop_path?: string[] | string
    plot?: string
    cast?: string
    director?: string
    genre?: string
    releasedate?: string
    rating?: string
    duration?: string
    duration_secs?: number
    youtube_trailer?: string
    episode_run_time?: string
    language?: string
    age?: string
    country?: string
    tmdb_id?: string
    video?: { width?: string; height?: string }
    audio?: { channels?: string; codec?: string; language?: string }
    bitrate?: number
  }
  movie_data?: RawVodStream
}

export interface RawSeries {
  num?: number
  name: string
  series_id: number
  cover?: string
  plot?: string
  cast?: string
  director?: string
  genre?: string
  releaseDate?: string
  last_modified?: string
  rating?: string
  rating_5based?: number
  backdrop_path?: string[] | string
  youtube_trailer?: string
  episode_run_time?: string
  category_id?: string
  language?: string
}

export interface RawEpisode {
  id: string | number
  episode_num: number | string
  title: string
  container_extension?: string
  season?: number | string
  info?: {
    movie_image?: string
    plot?: string
    releasedate?: string
    rating?: string
    duration_secs?: number
    duration?: string
    video?: unknown
    audio?: unknown
    bitrate?: number
  }
}

export interface RawSeason {
  season_number: number | string
  episode_count?: number
  cover?: string
  name?: string
  episodes?: RawEpisode[]
}

export interface SeriesInfo {
  seasons: RawSeason[]
  info?: Record<string, unknown>
  episodes?: Record<string, RawEpisode[]>
}

export interface RawEpgListing {
  id?: string
  epg_id?: string
  title: string
  lang?: string
  start: string
  end: string
  description?: string
  channel_id?: string
  start_timestamp?: string | number
  stop_timestamp?: string | number
  now_playing?: number
  has_archive?: number
}

// ------------------------- normalized catalog ------------------------------

export interface Edition {
  streamId: number
  quality: Quality
  languages: string[]
  container?: string
  label: string
  addedAt: number
  /** For series episodes: the parent series id. */
  seriesId?: number
  episodeId?: number
  season?: number
  episode?: number
}

export interface Title {
  key: string
  kind: 'movie' | 'series' | 'live'
  id: number
  name: string
  cleanName: string
  year?: number
  rating?: number
  ageRating?: string
  durationSec?: number
  plot?: string
  genres: string[]
  cast: string[]
  director?: string
  country?: string
  poster?: string
  backdrop?: string
  trailer?: string
  quality: Quality
  languages: string[]
  editions: Edition[]
  categoryId: string
  categoryName: string
  addedAt: number
  provider: Provider
  vnteraOriginal?: boolean
  blockbuster?: boolean
  episodeRunTime?: string
  seasons?: number
  latestEpisode?: string
  epgChannelId?: string
  tvArchive?: number
  num?: number
  hasArtwork: boolean
  /// Local popularity signal (watch history) used by Top 10 / Trending.
  watchCount?: number
}

export interface CatalogCounts {
  channels: number
  movies: number
  series: number
}

export interface CatalogSnapshot {
  account: string
  builtAt: number
  demo: boolean
  channels: Title[]
  movies: Title[]
  series: Title[]
  categories: {
    live: RawCategory[]
    vod: RawCategory[]
    series: RawCategory[]
  }
  counts: CatalogCounts
  serverTimezone?: string
}

export interface EpgProgramme {
  channelId: string
  start: number
  end: number
  title: string
  description?: string
  lang?: string
  hasArchive?: boolean
}

export interface ProgressEntry {
  contentId: number
  contentType: MediaKind
  title: string
  thumbnail?: string
  progress: number
  duration: number
  lastWatched: number
  season?: number
  episode?: number
  episodeTitle?: string
  /** Series/title key so a series resume can reopen the right episode. */
  parentId?: number
  provider?: Provider
}

export interface ListEntry {
  contentId: number
  contentType: 'movie' | 'series' | 'live'
  addedAt: number
}

export interface NotificationItem {
  id: string
  kind: 'content' | 'live' | 'system'
  title: string
  body: string
  createdAt: number
  read: boolean
  href?: string
  poster?: string
}

export interface Settings {
  quality: 'auto' | '4K' | 'FHD' | 'HD' | 'SD'
  autoplayNext: boolean
  autoplayPreviews: boolean
  subtitlesEnabled: boolean
  subtitleLanguage: string
  audioLanguage: string
  contentLanguage: 'all' | 'ar' | 'en' | 'fr'
  dataSaver: boolean
  wifiOnlyDownloads: boolean
  notifications: boolean
  epgAlerts: boolean
  uiLanguage: 'en' | 'ar'
  reduceMotion: boolean
}
