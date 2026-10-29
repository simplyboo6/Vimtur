import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { ListItem } from 'app/shared/types';
import { faBars } from '@fortawesome/free-solid-svg-icons';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';

@Component({
  selector: 'app-actions',
  templateUrl: './actions.component.html',
  styleUrls: ['./actions.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FaIconComponent],
})
export class ActionsComponent {
  public open = false;
  public readonly faBars = faBars;

  @Input() public actions?: ListItem<any>[];
  @Output() public actionSelected = new EventEmitter<ListItem<any>>();
}
