import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { QualityLevel } from 'app/shared/types';

@Injectable({
  providedIn: 'root',
})
export class QualityService {
  public readonly qualityLevels: ReplaySubject<QualityLevel[] | undefined> = new ReplaySubject(1);
  public readonly currentLevel: ReplaySubject<QualityLevel | undefined> = new ReplaySubject(1);
  public readonly setLevel: ReplaySubject<QualityLevel | undefined> = new ReplaySubject(1);
}
