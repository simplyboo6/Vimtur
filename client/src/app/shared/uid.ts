let uid = 0;

export function getUid(): string {
  return `uid-${uid++}`;
}
