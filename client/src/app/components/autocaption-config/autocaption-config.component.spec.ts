import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Configuration, ListedTask, QueuedTask, TaskArgs } from '@vimtur/common';
import { ReplaySubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from 'app/services/config.service';
import { ConfirmationService } from 'app/services/confirmation.service';
import { TasksService } from 'app/services/tasks.service';
import { AutocaptionConfigComponent } from './autocaption-config.component';

const APPLY_TASK_ID = 'AUTO-CAPTION-BLIP-BASE';
const OTHER_TASK_ID = 'AUTO-CAPTION-OTHER';

// Mirrors the two select arguments the server's AUTO-CAPTION task registers
// (server/src/tasks/autocaption/caption.ts): the modes and their confirmation
// texts are part of the roster, so the page must derive them rather than
// hard-code a second copy.
function createApplyTask(): ListedTask {
  return {
    id: APPLY_TASK_ID,
    description: 'Auto-Caption - Generate searchable captions for stills (BLIP)',
    args: [
      {
        type: 'select',
        name: 'Existing captions',
        values: [
          { id: 'skip-existing', name: 'Skip media that already has a generated caption' },
          { id: 'replace', name: 'Replace existing captions as media is recaptioned', confirm: 'Replace the existing captions.' },
        ],
      },
      {
        type: 'select',
        name: 'Caption media with manual tags',
        values: [
          { id: 'skip-tagged', name: 'Skip media the user has manually tagged' },
          { id: 'include-tagged', name: 'Include manually tagged media', confirm: 'Include the manually tagged media.' },
        ],
      },
    ],
  };
}

function createConfig(model = APPLY_TASK_ID): Configuration.Main {
  return { user: {}, autocaption: { model, workers: 2, maxTokens: 30 } } as unknown as Configuration.Main;
}

function createQueueEntry(overrides: Partial<QueuedTask>): QueuedTask {
  return {
    id: '1',
    type: APPLY_TASK_ID,
    description: 'Auto-Caption - Generate searchable captions for stills (BLIP)',
    running: false,
    aborted: false,
    current: 0,
    max: 0,
    complete: false,
    ...overrides,
  };
}

describe('AutocaptionConfigComponent', () => {
  let fixture: ComponentFixture<AutocaptionConfigComponent>;
  let config: ReplaySubject<Configuration.Main>;
  let tasks: ReplaySubject<ListedTask[]>;
  let queue: ReplaySubject<QueuedTask[]>;
  let updateConfiguration: ReturnType<typeof vi.fn>;
  let startAction: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = new ReplaySubject<Configuration.Main>(1);
    tasks = new ReplaySubject<ListedTask[]>(1);
    queue = new ReplaySubject<QueuedTask[]>(1);
    updateConfiguration = vi.fn();
    startAction = vi.fn();
    confirm = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [AutocaptionConfigComponent],
      providers: [
        { provide: ConfigService, useValue: { getConfiguration: () => config, updateConfiguration } },
        { provide: TasksService, useValue: { getTasks: () => tasks, getQueue: () => queue, startAction } },
        { provide: ConfirmationService, useValue: { confirm } },
      ],
    });

    fixture = TestBed.createComponent(AutocaptionConfigComponent);
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('derives the model options from the listed AUTO-CAPTION tasks', () => {
    tasks.next([createApplyTask(), { id: OTHER_TASK_ID, description: 'Other caption model' }, { id: 'SCAN', description: 'Scan the library' }]);
    config.next(createConfig());
    fixture.detectChanges();

    const options = fixture.debugElement.queryAll(By.css('#autocaption-model-select option'));
    expect(options).toHaveLength(2);
    expect(options.map(option => option.nativeElement.textContent?.trim())).toEqual([
      'Auto-Caption - Generate searchable captions for stills (BLIP)',
      'Other caption model',
    ]);
  });

  it('renders a stored model the server does not list', () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig('AUTO-CAPTION-RETIRED'));
    fixture.detectChanges();

    const options = fixture.debugElement.queryAll(By.css('#autocaption-model-select option'));
    expect(options.map(option => option.nativeElement.textContent?.trim())).toEqual([
      'AUTO-CAPTION-RETIRED (not listed by this server)',
      'Auto-Caption - Generate searchable captions for stills (BLIP)',
    ]);
  });

  it('persists the worker count and max tokens through the config overlay', () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    fixture.detectChanges();

    const workerCount = fixture.debugElement.query(By.css('#autocaption-worker-count')).nativeElement as HTMLInputElement;
    workerCount.value = '4';
    workerCount.dispatchEvent(new Event('change'));
    expect(updateConfiguration).toHaveBeenCalledWith({ autocaption: { workers: 4 } });

    const maxTokens = fixture.debugElement.query(By.css('#autocaption-max-tokens')).nativeElement as HTMLInputElement;
    maxTokens.value = '12';
    maxTokens.dispatchEvent(new Event('change'));
    expect(updateConfiguration).toHaveBeenLastCalledWith({ autocaption: { maxTokens: 12 } });
  });

  it('clamps saved numbers to the schema bounds and ignores an empty input', () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.saveWorkerCount(0);
    expect(updateConfiguration).toHaveBeenLastCalledWith({ autocaption: { workers: 1 } });
    component.saveWorkerCount(9);
    expect(updateConfiguration).toHaveBeenLastCalledWith({ autocaption: { workers: 8 } });
    component.saveMaxTokens(0);
    expect(updateConfiguration).toHaveBeenLastCalledWith({ autocaption: { maxTokens: 1 } });
    component.saveMaxTokens(101);
    expect(updateConfiguration).toHaveBeenLastCalledWith({ autocaption: { maxTokens: 100 } });

    // .valueAsNumber is NaN for a typed-but-empty field, so nothing is posted.
    updateConfiguration.mockClear();
    component.saveWorkerCount(Number.NaN);
    component.saveMaxTokens(Number.NaN);
    expect(updateConfiguration).not.toHaveBeenCalled();
  });

  it('queues the selected task with the server defaults when Apply is clicked', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-apply')).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(confirm).not.toHaveBeenCalled();
    expect(startAction).toHaveBeenCalledWith(APPLY_TASK_ID, ['skip-existing', 'skip-tagged'], expect.any(Function));
  });

  it('does not queue the apply task when the selected model is not listed', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig('AUTO-CAPTION-RETIRED'));
    fixture.detectChanges();

    await fixture.componentInstance.apply();

    expect(confirm).not.toHaveBeenCalled();
    expect(startAction).not.toHaveBeenCalled();
  });

  it('confirms each non-default apply mode before queueing it', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    fixture.detectChanges();

    const mode = fixture.debugElement.query(By.css('#autocaption-apply-mode')).nativeElement as HTMLSelectElement;
    mode.selectedIndex = 1;
    mode.dispatchEvent(new Event('change'));
    const taggedMode = fixture.debugElement.query(By.css('#autocaption-apply-tagged-mode')).nativeElement as HTMLSelectElement;
    taggedMode.selectedIndex = 1;
    taggedMode.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-apply')).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledWith('Replace the existing captions.');
    expect(confirm).toHaveBeenCalledWith('Include the manually tagged media.');
    expect(startAction).toHaveBeenCalledWith(APPLY_TASK_ID, ['replace', 'include-tagged'], expect.any(Function));
  });

  it('releases the apply latch when the confirmation is declined', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    confirm.mockResolvedValue(false);
    fixture.detectChanges();

    const mode = fixture.debugElement.query(By.css('#autocaption-apply-mode')).nativeElement as HTMLSelectElement;
    mode.selectedIndex = 1;
    mode.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-apply')).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalledWith('Replace the existing captions.');
    expect(startAction).not.toHaveBeenCalled();
    // The latch is released on a decline, so the button cannot stay disabled.
    expect(button.disabled).toBe(false);
  });

  it('releases the apply latch when the start request is rejected', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    fixture.detectChanges();

    let settle: ((err: HttpErrorResponse | undefined) => void) | undefined;
    startAction.mockImplementation((_id: string, _args: TaskArgs, onSettled: (err: HttpErrorResponse | undefined) => void) => {
      settle = onSettled;
    });

    const button = fixture.debugElement.query(By.css('#autocaption-apply')).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // The request latches the button until the server broadcasts the entry.
    expect(button.disabled).toBe(true);
    expect(settle).toBeDefined();

    settle?.(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    expect(button.disabled).toBe(false);
  });

  it("drops the previous model's failure when the selection changes", () => {
    tasks.next([createApplyTask(), { id: OTHER_TASK_ID, description: 'Other caption model', args: createApplyTask().args }]);
    config.next(createConfig(APPLY_TASK_ID));
    queue.next([createQueueEntry({ complete: true, error: 'model exploded' })]);
    fixture.detectChanges();
    expect(fixture.componentInstance.applyStatus()).toBe('Failed — model exploded');

    // The failed run belongs to the previous task id: its entry stays in the
    // queue, but it must not colour the newly selected model's status.
    config.next(createConfig(OTHER_TASK_ID));
    queue.next([createQueueEntry({ complete: true, error: 'model exploded' })]);
    fixture.detectChanges();
    expect(fixture.componentInstance.applyStatus()).toBe('Idle — not currently running.');
  });

  it('disables Apply while the selected task is in flight', () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    queue.next([createQueueEntry({ running: true })]);
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-apply')).nativeElement as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('confirms and queues the clear task', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    queue.next([]);
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-clear')).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledWith('This removes generated captions from every media item.');
    expect(startAction).toHaveBeenCalledWith('CLEAR-AUTOCAPTIONS', undefined, expect.any(Function));
  });

  it('releases the clear latch when the confirmation is declined', async () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    queue.next([]);
    confirm.mockResolvedValue(false);
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-clear')).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(startAction).not.toHaveBeenCalled();
    // The latch is released on a decline, so the button cannot stay disabled.
    expect(button.disabled).toBe(false);
  });

  it('disables Clear while the clear task is in flight', () => {
    tasks.next([createApplyTask()]);
    config.next(createConfig());
    queue.next([createQueueEntry({ id: '2', type: 'CLEAR-AUTOCAPTIONS' })]);
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('#autocaption-clear')).nativeElement as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
