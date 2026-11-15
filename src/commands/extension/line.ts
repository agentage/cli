// One report line: a 10-column label, then the value.
export const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;
