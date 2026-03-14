export class StopController {
  private requested = false;

  private reason: string | null = null;

  request(reason: string): void {
    this.requested = true;
    this.reason = reason;
  }

  get isRequested(): boolean {
    return this.requested;
  }

  get requestReason(): string | null {
    return this.reason;
  }
}
