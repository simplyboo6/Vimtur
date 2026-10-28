import { Component, ChangeDetectionStrategy } from '@angular/core';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-prompt-modal',
  templateUrl: './prompt-modal.component.html',
  styleUrls: ['./prompt-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule],
})
export class PromptModalComponent {
  public title?: string;
  public text?: string;
  public modal?: NgbModalRef;
}
