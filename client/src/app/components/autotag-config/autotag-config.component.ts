import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleXmark } from '@fortawesome/free-regular-svg-icons';

type AutotagStatus = 'Calibrated' | 'Review (low support)' | 'Not calibrated' | 'Manually overridden';

// Status vocabulary in one place: the table badges AND the legend read from here, so a new status or rename updates everywhere and heads off silent drift.
const STATUS_BADGE_CLASSES: Record<AutotagStatus, string> = {
  'Calibrated': 'text-bg-success',
  'Review (low support)': 'text-bg-warning',
  'Not calibrated': 'text-bg-secondary',
  'Manually overridden': 'text-bg-info',
};

// Every status must have a legend entry; Object.entries keeps the declared display order.
const STATUS_LEGEND: Record<AutotagStatus, string> = {
  'Calibrated': 'meets the support floor and applies automatically.',
  'Review (low support)': 'below the support floor: tag more media or improve the description and re-run calibration — or override the threshold manually.',
  'Not calibrated': 'missing a calibrated threshold: it needs tagged examples and a calibration run; a threshold you type yourself is applied as-is.',
  'Manually overridden':
    'typed in by you and applied as-is — an explicit override of the calibration floor; expect notably worse precision until it is calibrated.',
};

interface AutotagDescriptionMock {
  // Mock-local id so @for tracks rows by identity, not index (removal stays stable).
  id: number;
  text: string;
}

interface AutotagTagMock {
  tag: string;
  // Each entry is a scored prompt; the strongest match decides the tag's score.
  descriptions: AutotagDescriptionMock[];
  // Not set until the calibration run assigns one — or the user overrides it manually (see the help text under the table).
  // null = user cleared the field, undefined = never calibrated. The mock collapses the calibrated and manual values into
  // this one field; wiring should keep the calibrated value stored separately. Normalise null to absence before persisting.
  threshold?: number | null;
  support: number;
  // What the calibration run concluded for this row, kept separately from the rendered status so clearing a
  // manual threshold override restores the true calibration state instead of a generic "Not calibrated".
  calibratedStatus: AutotagStatus;
  status: AutotagStatus;
  quality?: number; // Last measured per-tag quality (AUROC), when calibrated.
}

@Component({
  selector: 'app-autotag-config',
  templateUrl: './autotag-config.component.html',
  styleUrls: ['./autotag-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, FaIconComponent],
})
export class AutotagConfigComponent {
  // Mocked UI state. Nothing is wired to services yet: this page is a visual mock for design review (#131).
  public readonly faCircleXmark = faCircleXmark;
  public readonly statusBadgeClasses = STATUS_BADGE_CLASSES;
  public readonly statusLegend: ReadonlyArray<{ status: AutotagStatus; description: string }> = (
    Object.entries(STATUS_LEGEND) as [AutotagStatus, string][]
  ).map(([status, description]) => ({ status, description }));
  public workerCount = 5;
  public minSupport = 8;
  public calibrationSampleSize = 500;
  public addTagModel?: string;
  // Mock state: ng-bootstrap destroys the hidden tab pane, so this resets when switching tabs. Real wiring will store this in the configuration.
  public selectedModel = 'siglip2';
  public tags: AutotagTagMock[] = [
    // deliberately illustrative mock rows
    {
      tag: 'sunset',
      descriptions: [
        { id: 1, text: 'a photo of sunset' },
        { id: 2, text: 'a sunset sky with a low sun' },
      ],
      threshold: 0.42,
      support: 86,
      status: 'Calibrated',
      calibratedStatus: 'Calibrated',
      quality: 0.93,
    },
    {
      tag: 'screenshot',
      descriptions: [
        { id: 3, text: 'a photo of screenshot' },
        { id: 4, text: 'a screenshot of a device screen or software UI' },
      ],
      threshold: 0.38,
      support: 54,
      status: 'Calibrated',
      calibratedStatus: 'Calibrated',
      quality: 0.89,
    },
    { tag: 'video game', descriptions: [{ id: 5, text: 'a photo of video game' }], support: 3, status: 'Not calibrated', calibratedStatus: 'Not calibrated' },
    {
      tag: 'fireworks',
      descriptions: [
        { id: 6, text: 'a photo of fireworks' },
        { id: 7, text: 'fireworks exploding in a dark sky' },
      ],
      threshold: 0.31,
      support: 6,
      status: 'Review (low support)',
      calibratedStatus: 'Review (low support)',
      quality: 0.78,
    },
    {
      tag: 'waterfall',
      descriptions: [
        { id: 8, text: 'a photo of waterfall' },
        { id: 9, text: 'a waterfall or running water over rock' },
      ],
      threshold: 0.47,
      support: 39,
      status: 'Calibrated',
      calibratedStatus: 'Calibrated',
      quality: 0.91,
    },
    {
      tag: 'metal',
      descriptions: [
        { id: 10, text: 'a photo of metal' },
        { id: 11, text: 'visible metal or metalwork in the frame' },
      ],
      threshold: 0.51,
      support: 41,
      status: 'Calibrated',
      calibratedStatus: 'Calibrated',
      quality: 0.94,
    },
    {
      tag: 'cat',
      descriptions: [
        { id: 12, text: 'a photo of cat' },
        { id: 13, text: 'a cat with clearly visible fur' },
      ],
      threshold: 0.44,
      support: 71,
      status: 'Calibrated',
      calibratedStatus: 'Calibrated',
      quality: 0.96,
    },
    {
      tag: 'long-exposure',
      descriptions: [{ id: 14, text: 'a photo of long-exposure' }],
      support: 0,
      status: 'Not calibrated',
      calibratedStatus: 'Not calibrated',
    },
  ];
  private descriptionIdNext = 15;

  // Mock-local re-derivation, deliberately on blur rather than per keystroke: NumberValueAccessor emits
  // null for transient unparseable input (e.g. a leading "-") mid-edit, so deriving only when the user
  // leaves the field cannot flap the status from a half-typed value. Wiring re-derives from persisted state.
  public onThresholdBlur(tag: AutotagTagMock): void {
    if (tag.threshold === null) {
      // Cleared: restore what calibration actually concluded, not a generic "Not calibrated".
      tag.status = tag.calibratedStatus;
    } else if (tag.status !== 'Calibrated') {
      // Typed into a non-eligible row: the manual override applies as-is.
      tag.status = 'Manually overridden';
    }
  }

  public addDescription(tag: AutotagTagMock): void {
    // Mock-local state change; persistence comes with wiring.
    tag.descriptions.push({ id: this.descriptionIdNext++, text: '' });
  }

  public removeDescription(tag: AutotagTagMock, index: number): void {
    // Mock-local state change; persistence comes with wiring.
    tag.descriptions.splice(index, 1);
  }
}
