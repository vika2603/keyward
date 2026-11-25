/**
 * Runs the tasks given to it one after another, each once the one before has settled, so tasks
 * that read, change and write the same stored value cannot overwrite each other's changes.
 */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = last.then(task)
    last = run.catch(() => {})
    return run
  }
}
