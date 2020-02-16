export interface Alert {
  type: 'success' | 'info' | 'warning' | 'danger' | 'primary' | 'secondary';
  message: string;
  autoClose?: number;
}

export interface QualityLevel {
  width?: number;
  height?: number;
  index: number;
}

export interface ListItem<T = string> {
  id: T;
  itemName: string;
}

export function toListItems(values: string[]): ListItem[] {
  return values.map(value => ({ id: value, itemName: value }));
}
