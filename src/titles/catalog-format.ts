export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value as unknown[])
        .filter(
          (item) => item && typeof item === 'object' && !Array.isArray(item),
        )
        .map(record)
    : [];
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function imageUrl(
  path: unknown,
  size: 'w185' | 'w500' | 'w1280' | 'original' = 'w500',
) {
  return typeof path === 'string' && /^\/[A-Za-z0-9_.-]+$/.test(path)
    ? `https://image.tmdb.org/t/p/${path.endsWith('.svg') ? 'original' : size}${path}`
    : null;
}

export function rating(payload: Record<string, unknown>) {
  return {
    source: 'TMDB',
    value: number(payload.vote_average),
    votes: number(payload.vote_count),
  };
}

export function creditRoles(entries: unknown) {
  const items = records(entries);
  const roles = items
    .flatMap((item) => [
      text(item.character),
      ...records(item.roles).map((role) => text(role.character)),
    ])
    .filter((item): item is string => item !== null);
  const jobs = items
    .flatMap((item) => [
      text(item.job),
      ...records(item.jobs).map((job) => text(job.job)),
    ])
    .filter((item): item is string => item !== null);
  return { characters: [...new Set(roles)], jobs: [...new Set(jobs)] };
}

export function imageItems(items: unknown) {
  return records(items)
    .map((item) => ({
      path: text(item.file_path),
      url: imageUrl(item.file_path, 'w1280'),
      width: number(item.width),
      height: number(item.height),
      language: text(item.iso_639_1),
    }))
    .filter((item) => item.url);
}

export function videoItems(items: unknown) {
  return records(items)
    .filter(
      (video) =>
        video.site === 'YouTube' &&
        typeof video.key === 'string' &&
        /^[A-Za-z0-9_-]{11}$/.test(video.key),
    )
    .map((video) => ({
      id: text(video.id),
      name: text(video.name),
      key: video.key as string,
      type: text(video.type),
      language: text(video.iso_639_1),
      official: video.official === true,
      embedUrl: `https://www.youtube-nocookie.com/embed/${video.key as string}`,
      watchUrl: `https://www.youtube.com/watch?v=${video.key as string}`,
    }))
    .sort((a, b) => {
      const score = (v: typeof a) =>
        (v.type === 'Trailer' ? 100 : v.type === 'Teaser' ? 50 : 0) +
        (v.official ? 20 : 0) +
        (v.language === 'ru' ? 10 : 0);
      return score(b) - score(a);
    });
}

export function mediaView(
  payload: Record<string, unknown> | null,
  fetchedAt: Date | null,
) {
  const images = record(payload?.images);
  const videos = videoItems(payload?.videos);
  const backdrops = imageItems(images.backdrops);
  const posters = imageItems(images.posters);
  const releaseRatings = records(
    record(payload?.release_dates).results,
  ).flatMap((country) =>
    records(country.release_dates)
      .filter((release) => text(release.certification))
      .map((release) => ({
        country: text(country.iso_3166_1),
        rating: text(release.certification),
      })),
  );
  const tvRatings = records(record(payload?.content_ratings).results)
    .filter((item) => text(item.rating))
    .map((item) => ({
      country: text(item.iso_3166_1),
      rating: text(item.rating),
    }));
  const certifications = [
    ...new Map(
      [...releaseRatings, ...tvRatings].map((item) => [
        `${item.country}:${item.rating}`,
        item,
      ]),
    ).values(),
  ];
  return {
    loaded: payload !== null,
    fetchedAt,
    trailer:
      videos.find((video) => video.type === 'Trailer') ??
      videos.find((video) => video.type === 'Teaser') ??
      null,
    videos: videos.slice(0, 30),
    backdrops: backdrops.slice(0, 40),
    backdropCount: backdrops.length,
    posters: posters.slice(0, 40),
    posterCount: posters.length,
    logos: imageItems(images.logos).slice(0, 20),
    certifications,
    preferredCertification:
      certifications.find((item) => item.country === 'RU') ??
      certifications.find((item) => item.country === 'US') ??
      null,
    releaseDates: record(payload?.release_dates).results ?? [],
    contentRatings: record(payload?.content_ratings).results ?? [],
  };
}
