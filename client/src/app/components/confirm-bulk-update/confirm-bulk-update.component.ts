import { Component } from '@angular/core';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { SubsetConstraints } from '@vimtur/common';

@Component({
  selector: 'app-confirm-bulk-update',
  templateUrl: './confirm-bulk-update.component.html',
  styleUrls: ['./confirm-bulk-update.component.scss'],
})
export class ConfirmBulkUpdateComponent {
  public constraints?: SubsetConstraints;
  public modal?: NgbModalRef;

  public isConstraintsEmpty(): boolean {
    if (!this.constraints) {
      return true;
    }
    return Object.keys(this.constraints).length === 0;
  }
}
