export interface GreetingInput {
  name: string;
}

export function greeting(input: GreetingInput): string {
  return `hello ${input.name}`;
}
