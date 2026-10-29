export interface TaskArgDefinitionBase {
  type: string;
  name: string;
  required?: boolean;
}

export interface TaskArgDefinitionString extends TaskArgDefinitionBase {
  type: 'string';
}

export interface TaskArgDefinitionSelectValue {
  id: string;
  name: string;
  // Confirmation message the client must show before starting the task with
  // this value selected; a task using a confirmed value is not started until
  // the user explicitly accepts. Messages should spell out what the value
  // makes the task do and that the action cannot be undone.
  confirm?: string;
}

export interface TaskArgDefinitionSelect extends TaskArgDefinitionBase {
  type: 'select';
  values: TaskArgDefinitionSelectValue[];
}

export type TaskArgDefinition = TaskArgDefinitionString | TaskArgDefinitionSelect;
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
