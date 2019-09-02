export interface CalculatedAverage {
  average: number;
  count: number;
}

export interface SortedAverage extends CalculatedAverage {
  name: string;
}

export interface InsightsResponse {
  tags: SortedAverage[];
  actors: SortedAverage[];
  artists: SortedAverage[];
}
