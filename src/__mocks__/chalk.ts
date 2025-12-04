/* eslint-disable @typescript-eslint/explicit-function-return-type */

const createChainableColor = () => {
  const fn = (s: string) => s;
  // Add chainable methods
  fn.underline = (s: string) => s;
  fn.bold = (s: string) => s;
  return fn;
};

const createBoldColor = () => {
  const fn = (s: string) => s;
  fn.yellow = (s: string) => s;
  return fn;
};

const chalk = {
  blue: createChainableColor(),
  cyan: createChainableColor(),
  gray: createChainableColor(),
  green: createChainableColor(),
  yellow: createChainableColor(),
  red: createChainableColor(),
  white: createChainableColor(),
  bold: createBoldColor(),
};

export default chalk;
