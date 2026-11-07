import path from 'node:path';
import log from 'electron-log/main';

export function configureLogger(logsDir: string, debug: boolean): typeof log {
  log.transports.file.resolvePathFn = () => path.join(logsDir, 'main.log');
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = debug ? 'debug' : 'info';
  log.transports.console.level = debug ? 'debug' : false;
  return log;
}

export { log };
