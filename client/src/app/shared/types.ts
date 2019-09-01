export interface Alert {
  type: 'success' | 'info' | 'warning' | 'danger' | 'primary' | 'secondary';
  message: string;
  autoClose?: number;
}
