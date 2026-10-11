import { TRIGGER_GAP_MS, TRIGGER_HOLD_MS, TRIGGER_REARM_MS } from './constants';

export type TriggerState = 'waiting' | 'counting' | 'playing' | 'rearming';

// Decides when a visitor standing in the ring starts the sequence.
export class VisitorTrigger {
  state: TriggerState = 'waiting';
  onTrigger: () => void = () => {};
  private insideSince = 0;
  private lastInside = -Infinity;

  // Called once per frame with whether a clip is on stage.
  setPlaying(playing: boolean, now: number) {
    if (playing && this.state !== 'playing') {
      this.state = 'playing';
    } else if (!playing && this.state === 'playing') {
      this.state = 'rearming';
      this.lastInside = now;
    }
  }

  // Called once per detection with whether any feet point is inside the ring.
  observe(now: number, anyInside: boolean) {
    if (anyInside) this.lastInside = now;
    switch (this.state) {
      case 'waiting':
        if (anyInside) {
          this.state = 'counting';
          this.insideSince = now;
        }
        break;
      case 'counting':
        if (!anyInside && now - this.lastInside > TRIGGER_GAP_MS) {
          this.state = 'waiting';
        } else if (now - this.insideSince >= TRIGGER_HOLD_MS) {
          this.state = 'playing';
          this.onTrigger();
        }
        break;
      case 'rearming':
        if (now - this.lastInside >= TRIGGER_REARM_MS) this.state = 'waiting';
        break;
      default:
        break;
    }
  }
}
