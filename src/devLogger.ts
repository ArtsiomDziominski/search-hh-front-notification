import { isDevelopment } from "./constants";

export const devLog = (...args: unknown[]): void => {
  if (isDevelopment) {
    console.log(...args);
  }
};

export const devWarn = (...args: unknown[]): void => {
  if (isDevelopment) {
    console.warn(...args);
  }
};

export const devError = (...args: unknown[]): void => {
  if (isDevelopment) {
    console.error(...args);
  }
};
