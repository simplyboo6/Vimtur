import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ListItem } from 'app/shared/types';

@Component({
  selector: 'app-actions',
  templateUrl: './actions.component.html',
  styleUrls: ['./actions.component.scss'],
})
export class ActionsComponent {
  public open = false;

  @Input() public actions?: ListItem<any>[];
  @Output() public actionSelected = new EventEmitter<ListItem<any>>();
}
