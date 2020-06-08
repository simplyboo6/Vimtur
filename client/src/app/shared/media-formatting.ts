import { Media } from '@vimtur/common';

export function padTime(length: number): string {
  return length < 10 ? `0${length}` : `${length}`;
}

export function formatLength(length: number): string {
  const hours = Math.floor(length / 3600);
  length -= hours * 3600;
  const minutes = Math.floor(length / 60);
  length -= minutes * 60;
  const seconds = Math.floor(length);
  return `${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)}`;
}

export function getTitle(media: Media): string {
  const titles: string[] = [];
  if (media.metadata.album) {
    titles.push(media.metadata.album);
  }
  if (media.metadata.title) {
    titles.push(media.metadata.title);
  }
  const title = titles.join(' - ');
  return title || media.path.split('/').slice(-1)[0];
}

export function getSubtitle(media: Media): string {
  switch (media.type) {
    case 'video':
      return `Video | ${formatLength(media.metadata.length)} | ${media.metadata.width}x${
        media.metadata.height
      }`;
    case 'still':
      return `Still | ${media.metadata.width}x${media.metadata.height}`;
    case 'gif':
      return `Gif | ${media.metadata.width}x${media.metadata.height}`;
    default:
      return '';
  }
}
