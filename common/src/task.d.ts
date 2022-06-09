export interface TaskArgDefinitionBase {
  type: string;
  name: string;
  required?: boolean;
}

export interface TaskArgDefinitionString extends TaskArgDefinitionBase {
  type: "string";
}

export interface TaskArgDefinitionSelect extends TaskArgDefinitionBase {
  type: "select";
  values: Array<{ id: string; name: string }>;
}

export type TaskArgDefinition =
  | TaskArgDefinitionString
  | TaskArgDefinitionSelect;
export type TaskArgDefinitions = TaskArgDefinition[];
export type TaskArg = string;
export type TaskArgs = Array<TaskArg | undefined>;

export interface QueuedTask {
  id: string;
  type: string;
  description: string;
  running: boolean;
  aborted: boolean;
  current: number;
  max: number;
  error?: string;
  complete: boolean;
  args?: TaskArgs;
}

export interface ListedTask {
  id: string;
  description: string;
  args?: TaskArgDefinitions;
}
