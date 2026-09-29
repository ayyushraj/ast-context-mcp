export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserId = string;

export class UserService {
  constructor(private store: Map<UserId, User> = new Map()) {}

  createUser(name: string, email: string): User {
    const id = makeId();
    const user: User = { id, name, email };
    this.store.set(id, user);
    notify(user);
    return user;
  }

  getUser(id: UserId): User | undefined {
    return this.store.get(id);
  }
}

export function makeId(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

export function notify(user: User): void {
  console.log(`created ${user.name}`);
}

export function main(): void {
  const svc = new UserService();
  svc.createUser("Ada", "ada@example.com");
}
