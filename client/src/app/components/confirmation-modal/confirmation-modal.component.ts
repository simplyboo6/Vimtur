import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-confirmation-modal',
  templateUrl: './confirmation-modal.component.html',
  styleUrls: ['./confirmation-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule],
})
export class ConfirmationModalComponent {
  // Distinguishes the checkbox if two dialogs are open at once; the prefix keeps
  // it recognisable in devtools.
  private static nextCheckboxId = 0;

  public readonly checkboxId: string = `confirm-modal-checkbox-${ConfirmationModalComponent.nextCheckboxId++}`;

  public title?: string;
  public negative?: boolean;
  // Optional body content; the footer-only dialog is unchanged when none is set.
  public message?: string;
  public details?: string[];
  // Renders an unchecked-by-default checkbox whose state the caller reads back
  // alongside the confirmation.
  public checkboxLabel?: string;
  public checkbox = false;
  public modal?: NgbModalRef;
}
