import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'formatArray' })
export class FormatArrayPipe implements PipeTransform {
  public transform(value: string[]): string {
    return value.join(', ');
  }
}
