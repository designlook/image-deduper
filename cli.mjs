#!/usr/bin/env node

import process from 'node:process'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { scanDirectory, deleteDuplicates } from './scanner.mjs'

const HELP = `Image Deduper CLI

Find image files with different names but the exact same byte size and pixel
dimensions. By default, results are only listed and no files are changed.

Usage:
  image-deduper [directory] [options]
  node cli.mjs [directory] [options]

Arguments:
  directory                 Folder to scan (default: current directory)

Options:
  -h, --help                Show this help
  -v, --version             Show the version
  --no-recursive            Do not scan subdirectories
  --within <hours>          Only match files created within this many hours
  --min-size <size>         Skip smaller files (examples: 500KB, 2MB, 100000)
  --keep <oldest|newest>    Which file in each group to keep (default: oldest)
  --delete                  Permanently delete the other matching files
  -y, --yes                 Skip the deletion confirmation (requires --delete)
  --json                    Print scan results as JSON (cannot be used with --delete)

Examples:
  image-deduper
  image-deduper "C:\\Pictures" --no-recursive --min-size 500KB
  image-deduper ./exports --within 2 --keep newest
  image-deduper ./exports --delete
  image-deduper ./exports --delete --yes

Deletion is permanent and does not use the Recycle Bin or Trash.`

function fail(message) {
  const error = new Error(message)
  error.cli = true
  throw error
}

function optionValue(args, index, option) {
  const value = args[index + 1]
  if (value == null || value.startsWith('-')) fail(`${option} requires a value.`)
  return value
}

export function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i.exec(value)
  if (!match) fail('Minimum size must look like 500KB, 2MB, or a byte count.')
  const units = { b: 1, kb: 1000, kib: 1024, mb: 1000 ** 2, mib: 1024 ** 2, gb: 1000 ** 3, gib: 1024 ** 3 }
  const bytes = Number(match[1]) * units[(match[2] ?? 'b').toLowerCase()]
  if (!Number.isSafeInteger(bytes) || bytes < 0) fail('Minimum size is outside the supported range.')
  return bytes
}

export function parseArguments(args) {
  const options = {
    directory: process.cwd(), recursive: true, within: null, minSize: null,
    keep: 'oldest', delete: false, yes: false, json: false, help: false, version: false
  }
  let directorySeen = false

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '-h' || argument === '--help') options.help = true
    else if (argument === '-v' || argument === '--version') options.version = true
    else if (argument === '--no-recursive') options.recursive = false
    else if (argument === '--delete') options.delete = true
    else if (argument === '-y' || argument === '--yes') options.yes = true
    else if (argument === '--json') options.json = true
    else if (argument === '--within') {
      const value = optionValue(args, index, argument)
      options.within = Number(value)
      if (!Number.isFinite(options.within) || options.within <= 0) fail('--within must be a positive number of hours.')
      index++
    } else if (argument === '--min-size') {
      options.minSize = parseSize(optionValue(args, index, argument))
      index++
    } else if (argument === '--keep') {
      options.keep = optionValue(args, index, argument).toLowerCase()
      if (!['oldest', 'newest'].includes(options.keep)) fail('--keep must be oldest or newest.')
      index++
    } else if (argument.startsWith('-')) fail(`Unknown option: ${argument}`)
    else {
      if (directorySeen) fail('Only one directory may be specified.')
      options.directory = argument
      directorySeen = true
    }
  }

  if (options.yes && !options.delete) fail('--yes requires --delete.')
  if (options.json && options.delete) fail('--json cannot be combined with --delete.')
  return options
}

function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = units[0]
  for (let index = 1; value >= 1000 && index < units.length; index++) {
    value /= 1000
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString()
}

export function deletionGroups(groups, keep) {
  return groups.map(group => {
    const files = [group.keeper, ...group.duplicates]
      .sort((a, b) => a.created - b.created || a.path.localeCompare(b.path))
    const keeper = keep === 'newest' ? files.at(-1) : files[0]
    return { signature: group.signature, keeper, duplicates: files.filter(file => file.path !== keeper.path) }
  })
}

async function confirmDeletion(count, keep) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('Confirmation needs an interactive terminal. Add --yes for unattended deletion.')
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question(`Permanently delete ${count} files and keep the ${keep} in each group? [y/N] `)
    return /^y(?:es)?$/i.test(answer.trim())
  } finally {
    prompt.close()
  }
}

export async function run(args = process.argv.slice(2)) {
  const options = parseArguments(args)
  if (options.help) { console.log(HELP); return 0 }
  if (options.version) {
    const packageJson = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(new URL('./package.json', import.meta.url), 'utf8')))
    console.log(packageJson.version)
    return 0
  }

  const directory = path.resolve(options.directory)
  if (!(await stat(directory)).isDirectory()) fail(`Not a directory: ${directory}`)

  let stopped = false
  const stop = () => {
    if (stopped) process.exit(130)
    stopped = true
    console.error('\nStopping after the current file…')
  }
  process.once('SIGINT', stop)

  let result
  try {
    if (!options.json) console.error(`Scanning ${directory}${options.recursive ? ' (including subdirectories)' : ''}…`)
    result = await scanDirectory(directory, options.recursive, options.within, options.minSize, () => stopped)
  } finally {
    process.removeListener('SIGINT', stop)
  }

  const groups = deletionGroups(result.groups, options.keep)
  const selectedCount = groups.reduce((sum, group) => sum + group.duplicates.length, 0)
  const reclaimableBytes = groups.reduce((sum, group) => sum + group.duplicates.reduce((total, file) => total + file.size, 0), 0)

  if (options.json) {
    console.log(JSON.stringify({ ...result, groups, duplicateCount: selectedCount, reclaimableBytes }, null, 2))
    return result.stopped ? 130 : 0
  }

  console.log(`Images found:       ${result.totalImages}`)
  console.log(`Images inspected:   ${result.scanned}`)
  console.log(`Duplicate groups:   ${groups.length}`)
  console.log(`Copies found:       ${selectedCount}`)
  console.log(`Potential space:    ${formatBytes(reclaimableBytes)}`)
  if (result.filteredOut) console.log(`Below minimum size: ${result.filteredOut}`)
  if (result.skipped) console.log(`Unreadable/invalid: ${result.skipped}`)
  if (result.stopped) console.log('Scan stopped; showing partial results.')

  for (const [index, group] of groups.entries()) {
    console.log(`\nGroup ${index + 1} — ${group.keeper.width}x${group.keeper.height}, ${formatBytes(group.keeper.size)}`)
    console.log(`  KEEP    ${group.keeper.path} (${formatDate(group.keeper.created)})`)
    for (const file of group.duplicates) console.log(`  DELETE  ${file.path} (${formatDate(file.created)})`)
  }

  if (!selectedCount) return result.stopped ? 130 : 0
  if (!options.delete) {
    console.log('\nPreview only. Run again with --delete to permanently delete the listed copies.')
    return result.stopped ? 130 : 0
  }
  if (result.stopped) {
    console.log('\nNothing deleted because the scan was stopped.')
    return 130
  }
  if (!options.yes && !(await confirmDeletion(selectedCount, options.keep))) {
    console.log('Canceled. Nothing was deleted.')
    return 0
  }

  const deletion = await deleteDuplicates(directory, groups)
  console.log(`Deleted ${deletion.deleted} files; freed ${formatBytes(deletion.bytesFreed)}.`)
  for (const failure of deletion.failures) console.error(`Failed: ${failure.path} — ${failure.message}`)
  return deletion.failures.length ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  run().then(code => { process.exitCode = code }).catch(error => {
    console.error(`Error: ${error.message}`)
    if (error.cli) console.error('Run with --help for usage.')
    process.exitCode = 1
  })
}
