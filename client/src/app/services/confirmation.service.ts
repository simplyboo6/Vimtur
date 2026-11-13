import { Injectable } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ConfirmationModalComponent } from 'app/components/confirmation-modal/confirmation-modal.component';

export interface ConfirmationOptions {
  /** Keeps Cancel as the primary button; use for destructive confirmations. */
  negative?: boolean;
  /** Body paragraph shown above the footer. */
  message?: string;
  /** Body list, e.g. every path an action is about to remove. */
  details?: string[];
  /** Renders a checkbox and returns its state with the confirmation. */
  checkboxLabel?: string;
}

export interface ConfirmationResult {
  confirmed: boolean;
  checkbox: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class ConfirmationService {
  private modalService: NgbModal;

  public constructor(modalService: NgbModal) {
    this.modalService = modalService;
  }

  public confirm(title: string, negative?: boolean): Promise<boolean> {
    return this.confirmWith(title, { negative }).then(result => result.confirmed);
  }

  public confirmWith(title: string, options: ConfirmationOptions = {}): Promise<ConfirmationResult> {
    return new Promise(resolve => {
      const modalRef = this.modalService.open(ConfirmationModalComponent, {
        centered: true,
      });
      const modal = modalRef.componentInstance as ConfirmationModalComponent;
      modal.title = title;
      modal.negative = options.negative;
      modal.message = options.message;
      modal.details = options.details;
      modal.checkboxLabel = options.checkboxLabel;
      modal.checkbox = false;
      modal.modal = modalRef;
      modalRef.result
        .then(result => {
          // The checkbox state is read at close time: the modal result only
          // carries which button was pressed.
          resolve({ confirmed: result === true, checkbox: modal.checkbox });
        })
        .catch(() => {
          // A dismissed modal (backdrop click, Escape) is a cancel, and the
          // checkbox is irrelevant to that outcome.
          resolve({ confirmed: false, checkbox: modal.checkbox });
        });
    });
  }
}
