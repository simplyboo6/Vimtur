export interface CalculatedAverage {
  average: number;
  count: number;
}

export interface SortedAverage extends CalculatedAverage {
  name: string;
}

export type InsightsResponse = SortedAverage[];
