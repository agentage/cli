// An exit code a command that succeeded asks for (Ctrl-C on extension up is 130).
let wanted: number | null = null;

export const setExit = (code: number): void => void (wanted = code);

export const takeExit = (): number | null => {
  const code = wanted;
  wanted = null;
  return code;
};
