import { open, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

const EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'])

async function* walk(directory, includeSubdirectories) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory() && includeSubdirectories) yield* walk(filePath, true)
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield filePath
  }
}

function dimensionsFromBuffer(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM') {
    return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) }
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const type = buffer.toString('ascii', 12, 16)
    if (type === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
    if (type === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (type === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
    }
  }
  const order = buffer.toString('ascii', 0, 2)
  if (buffer.length >= 8 && (order === 'II' || order === 'MM')) {
    const little = order === 'II'
    const read16 = offset => little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset)
    const read32 = offset => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
    if (read16(2) === 42) {
      const ifd = read32(4)
      if (ifd + 2 <= buffer.length) {
        const count = read16(ifd)
        let width
        let height
        for (let index = 0; index < count; index++) {
          const offset = ifd + 2 + index * 12
          if (offset + 12 > buffer.length) break
          const tag = read16(offset)
          const type = read16(offset + 2)
          const value = type === 3 ? read16(offset + 8) : read32(offset + 8)
          if (tag === 256) width = value
          if (tag === 257) height = value
        }
        if (width && height) return { width, height }
      }
    }
  }
  return jpegDimensions(buffer)
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue }
    while (buffer[offset] === 0xff) offset++
    const marker = buffer[offset++]
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if (frames.has(marker) && length >= 7) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

async function inspect(filePath, existingStats = null) {
  const stats = existingStats ?? await stat(filePath)
  const handle = await open(filePath, 'r')
  try {
    const length = Math.min(stats.size, 1024 * 1024)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    const dimensions = dimensionsFromBuffer(buffer.subarray(0, bytesRead))
    if (!dimensions?.width || !dimensions?.height) return null
    return {
      path: filePath,
      filename: path.basename(filePath),
      normalizedFilename: path.basename(filePath).toLocaleLowerCase(),
      size: stats.size,
      width: dimensions.width,
      height: dimensions.height,
      created: stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.ctimeMs
    }
  } finally {
    await handle.close()
  }
}

function insideRoot(root, filePath) {
  const relative = path.relative(root, filePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export async function scanDirectory(directory, includeSubdirectories = true, maxCreationDifferenceHours = null, minFileSizeBytes = null, shouldStop = () => false) {
  const root = path.resolve(directory)
  if (!(await stat(root)).isDirectory()) throw new Error('The selected path is not a folder.')
  const signatures = new Map()
  let totalImages = 0
  let scanned = 0
  let skipped = 0
  let filteredOut = 0

  for await (const filePath of walk(root, includeSubdirectories)) {
    if (shouldStop()) break
    totalImages++
    try {
      const fileStats = await stat(filePath)
      if (minFileSizeBytes !== null && fileStats.size < minFileSizeBytes) {
        filteredOut++
        continue
      }
      const image = await inspect(filePath, fileStats)
      if (!image) { skipped++; continue }
      scanned++
      const key = `${image.size}:${image.width}x${image.height}`
      const files = signatures.get(key) ?? []
      files.push(image)
      signatures.set(key, files)
    } catch {
      skipped++
    }
  }

  const groups = []
  for (const [signature, files] of signatures) {
    if (files.length < 2) continue
    files.sort((a, b) => a.created - b.created || a.path.localeCompare(b.path))
    const keeper = files[0]
    const maximumDifferenceMs = maxCreationDifferenceHours == null
      ? Number.POSITIVE_INFINITY
      : maxCreationDifferenceHours * 60 * 60 * 1000
    const duplicates = files.slice(1).filter(file =>
      file.created > keeper.created &&
      file.created - keeper.created < maximumDifferenceMs &&
      file.normalizedFilename !== keeper.normalizedFilename
    )
    if (duplicates.length) groups.push({ signature, keeper, duplicates })
  }

  return {
    directory: root,
    includeSubdirectories,
    maxCreationDifferenceHours,
    minFileSizeBytes,
    stopped: shouldStop(),
    totalImages,
    scanned,
    skipped,
    filteredOut,
    groups,
    duplicateCount: groups.reduce((total, group) => total + group.duplicates.length, 0),
    reclaimableBytes: groups.reduce((total, group) => total + group.duplicates.reduce((sum, file) => sum + file.size, 0), 0)
  }
}

export async function deleteDuplicates(directory, groups) {
  const root = path.resolve(directory)
  let deleted = 0
  let bytesFreed = 0
  const failures = []

  for (const group of groups) {
    for (const candidate of group.duplicates ?? []) {
      try {
        if (!insideRoot(root, candidate.path)) throw new Error('File is outside the selected folder')
        const current = await inspect(candidate.path)
        if (!current) throw new Error('File is no longer a supported image')
        const signature = `${current.size}:${current.width}x${current.height}`
        if (signature !== group.signature || current.created !== candidate.created) {
          throw new Error('File changed after the scan')
        }
        await unlink(candidate.path)
        deleted++
        bytesFreed += current.size
      } catch (error) {
        failures.push({ path: candidate.path, message: error.message })
      }
    }
  }
  return { deleted, bytesFreed, failures }
}
