import { Injectable } from '@angular/core';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ConfirmationModalComponent } from 'app/components/confirmation-modal/confirmation-modal.component';

@Injectable({
  providedIn: 'root',
})
export class ConfirmationService {
  private modalService: NgbModal;

  public constructor(modalService: NgbModal) {
    this.modalService = modalService;
  }

  public confirm(title: string): Promise<boolean> {
    return new Promise(resolve => {
      const modalRef = this.modalService.open(ConfirmationModalComponent, {
        centered: true,
      });
      (modalRef.componentInstance as ConfirmationModalComponent).title = title;
      (modalRef.componentInstance as ConfirmationModalComponent).modal = modalRef;
      modalRef.result
        .then(result => {
          resolve(typeof result === 'boolean' ? result : false);
        })
        .catch(() => {
          resolve(false);
        });
    });
  }
}
