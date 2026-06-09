
interface LogEntry {
  level: 'info' | 'warn' | 'error'
  ts: string
  requestId: string
  projectId?: string
  event: string
  durationMs?: number
  meta?: unknown
}

export interface LogArgs {
  projectId?: string
  durationMs?: number
  meta?: unknown
}

function write(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n')
}

function makeEntry(
  level: LogEntry['level'],
  requestId: string,
  event: string,
  args?: LogArgs,
): LogEntry {
  const e: LogEntry = { level, ts: new Date().toISOString(), requestId, event }
  if (args?.projectId !== undefined) e.projectId = args.projectId
  if (args?.durationMs !== undefined) e.durationMs = args.durationMs
  if (args?.meta !== undefined) e.meta = args.meta
  return e
}

export const log = {
  info(requestId: string, event: string, args?: LogArgs): void {
    write(makeEntry('info', requestId, event, args))
  },
  warn(requestId: string, event: string, args?: LogArgs): void {
    write(makeEntry('warn', requestId, event, args))
  },
  error(requestId: string, event: string, args?: LogArgs): void {
    write(makeEntry('error', requestId, event, args))
  },
}
