import { Injectable } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { PromptModalComponent } from 'app/components/prompt-modal/prompt-modal.component';

@Injectable({
  providedIn: 'root',
})
export class PromptService {
  private modalService: NgbModal;

  public constructor(modalService: NgbModal) {
    this.modalService = modalService;
  }

  public prompt(title: string): Promise<string | undefined> {
    return new Promise(resolve => {
      const modalRef = this.modalService.open(PromptModalComponent, {
        centered: true,
      });
      (modalRef.componentInstance as PromptModalComponent).title = title;
      (modalRef.componentInstance as PromptModalComponent).modal = modalRef;
      modalRef.result
        .then(result => {
          resolve(typeof result === 'string' ? result : undefined);
        })
        .catch(err => {
          console.warn(err);
          resolve(undefined);
        });
    });
  }
}
