import { Greeter, helper, makeMessage } from './utils';

export function run(name: string): string {
  const greeter = new Greeter();
  return helper(makeMessage(name)) + greeter.greet(name);
}

export const IMPORTANT_VALUE = 42;
