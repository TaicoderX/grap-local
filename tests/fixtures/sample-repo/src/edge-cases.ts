import { Greeter, helper } from './utils';

export interface Speaker {
  speak(name: string): string;
}

export class LoudGreeter extends Greeter implements Speaker {
  public speak(name: string): string {
    const local = () => helper(name);
    local();
    return this.greet(name);
  }
}

export function outer(name: string): string {
  const inner = () => helper(name);
  inner();
  return helper(name);
}
