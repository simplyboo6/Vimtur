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
