import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deletionGroups, parseArguments, parseSize } from '../cli.mjs'
import { scanDirectory } from '../scanner.mjs'

test('uses the current folder and safe defaults', () => {
  const options = parseArguments([])
  assert.equal(options.delete, false)
  assert.equal(options.recursive, true)
  assert.equal(options.keep, 'oldest')
})

test('parses CLI filters and an explicit directory', () => {
  const options = parseArguments(['photos', '--no-recursive', '--within', '2', '--min-size', '500KB', '--keep', 'newest'])
  assert.equal(options.directory, 'photos')
  assert.equal(options.recursive, false)
  assert.equal(options.within, 2)
  assert.equal(options.minSize, 500000)
  assert.equal(options.keep, 'newest')
})

test('parses binary and decimal sizes', () => {
  assert.equal(parseSize('1.5MB'), 1500000)
  assert.equal(parseSize('2KiB'), 2048)
})

test('keeps newest when requested', () => {
  const oldest = { path: '/old.jpg', created: 1 }
  const newest = { path: '/new.jpg', created: 2 }
  const [group] = deletionGroups([{ signature: 'x', keeper: oldest, duplicates: [newest] }], 'newest')
  assert.equal(group.keeper.path, '/new.jpg')
  assert.deepEqual(group.duplicates.map(file => file.path), ['/old.jpg'])
})

test('rejects unattended confirmation without deletion mode', () => {
  assert.throws(() => parseArguments(['--yes']), /requires --delete/)
})

test('shared scanner finds same-size, same-dimension images with different names', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'image-deduper-cli-'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  try {
    await writeFile(path.join(directory, 'first.png'), png)
    await new Promise(resolve => setTimeout(resolve, 30))
    await writeFile(path.join(directory, 'second.png'), png)
    const result = await scanDirectory(directory, false)
    assert.equal(result.totalImages, 2)
    assert.equal(result.groups.length, 1)
    assert.equal(result.duplicateCount, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
