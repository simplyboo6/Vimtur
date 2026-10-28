import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { ListItem } from 'app/shared/types';
import { NgTemplateOutlet } from '@angular/common';

@Component({
  selector: 'app-actions',
  templateUrl: './actions.component.html',
  styleUrls: ['./actions.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [NgTemplateOutlet],
})
export class ActionsComponent {
  public open = false;

  @Input() public actions?: ListItem<any>[];
  @Output() public actionSelected = new EventEmitter<ListItem<any>>();
}
