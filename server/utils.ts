//const useColor =
//  process.stdout.isTTY &&
//  !("NO_COLOR" in process.env) &&
//  process.env.TERM !== "dumb";
const useColor = true;

const ansi = (open: string, close = "\x1b[0m") =>
  (s: string) => (useColor ? open + s + close : s);

export const color = {
  reset: (s: string) => (useColor ? `\x1b[0m${s}\x1b[0m` : s),

  bold: ansi("\x1b[1m"),
  dim: ansi("\x1b[2m"),

  red: ansi("\x1b[31m"),
  green: ansi("\x1b[32m"),
  yellow: ansi("\x1b[33m"),
  blue: ansi("\x1b[34m"),
  magenta: ansi("\x1b[35m"),
  cyan: ansi("\x1b[36m"),
  gray: ansi("\x1b[90m"),
};


export const logInfo = (...messages: any[]) => {
  console.log(color.yellow(new Date().toISOString()), ...messages);
}