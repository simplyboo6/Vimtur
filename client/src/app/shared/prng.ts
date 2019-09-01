export class PRNG {
  private seed: number;

  public constructor(seed: number) {
    this.seed = seed;
  }

  public nextFloat() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    const rnd = this.seed / 233280;

    return rnd;
  }
}
