import { Component } from '@angular/core';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-list-modal',
  templateUrl: './list-modal.component.html',
  styleUrls: ['./list-modal.component.scss'],
  standalone: false,
})
export class ListModalComponent {
  public title?: string;
  public items?: string[];
  public modal?: NgbModalRef;
}
