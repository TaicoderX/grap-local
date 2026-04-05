export interface User {
  name: string;
}

export type UserId = string;

export enum Role {
  Admin = 'admin',
  Member = 'member'
}

export function helper(name: string): string {
  return name.toUpperCase();
}

export const makeMessage = (name: string): string => {
  return helper(name);
};

export class Greeter {
  public greet(name: string): string {
    return helper(name);
  }
}
