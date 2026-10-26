import { packageRelease } from './release-artifacts.mjs'

try {
  for (const path of await packageRelease()) console.log(path)
} catch (error) {
  console.error(`Packaging failed: ${error.message}`)
  process.exitCode = 1
}
