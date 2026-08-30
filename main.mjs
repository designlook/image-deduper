import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanDirectory, deleteDuplicates } from './scanner.mjs'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
let mainWindow
let previewableFiles = new Set()
let latestScan = null
let activeScan = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 700,
    minHeight: 520,
    backgroundColor: '#e8edf3',
    show: false,
    title: 'Image Deduper',
    webPreferences: {
      preload: path.join(appDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.removeMenu()
  mainWindow.loadFile(path.join(appDirectory, 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

ipcMain.handle('choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an image folder',
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('scan-directory', async (_event, options) => {
  const directory = options?.directory
  const includeSubdirectories = options?.includeSubdirectories !== false
  const maxCreationDifferenceHours = options?.maxCreationDifferenceHours ?? null
  const minFileSizeBytes = options?.minFileSizeBytes ?? null
  const scanId = options?.scanId
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('Choose a valid folder first.')
  }
  if (maxCreationDifferenceHours !== null && ![1, 2, 3, 4, 5, 6, 12].includes(maxCreationDifferenceHours)) {
    throw new Error('Choose a valid creation-time difference.')
  }
  if (minFileSizeBytes !== null && (!Number.isFinite(minFileSizeBytes) || minFileSizeBytes < 0 || minFileSizeBytes > 1024 ** 4)) {
    throw new Error('Choose a valid minimum file size.')
  }
  const scan = { id: scanId, canceled: false }
  activeScan = scan
  let result
  try {
    result = await scanDirectory(
      directory,
      includeSubdirectories,
      maxCreationDifferenceHours,
      minFileSizeBytes,
      () => scan.canceled
    )
  } finally {
    if (activeScan === scan) activeScan = null
  }
  latestScan = result
  previewableFiles = new Set(result.groups.flatMap(group => [
    group.keeper.path,
    ...group.duplicates.map(file => file.path)
  ]))
  return result
})

ipcMain.handle('stop-scan', (_event, scanId) => {
  if (activeScan && activeScan.id === scanId) {
    activeScan.canceled = true
    return true
  }
  return false
})

ipcMain.handle('image-preview', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !previewableFiles.has(filePath)) return null
  const thumbnail = await nativeImage.createThumbnailFromPath(filePath, { width: 420, height: 300 })
  return thumbnail.isEmpty() ? null : thumbnail.toDataURL()
})

ipcMain.handle('delete-duplicates', async (_event, { directory, groups }) => {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || !Array.isArray(groups)) {
    throw new Error('The scan results are invalid. Scan the folder again.')
  }
  if (!latestScan || directory !== latestScan.directory) throw new Error('Scan the selected folder again.')
  const allowed = new Map(latestScan.groups.flatMap(group =>
    [group.keeper, ...group.duplicates].map(file => [file.path, group.signature])
  ))
  const latestGroups = new Map(latestScan.groups.map(group => [group.signature, group]))
  const selectionIsValid = groups.every(group => {
    const latestGroup = latestGroups.get(group.signature)
    if (!latestGroup || !Array.isArray(group.duplicates)) return false
    const candidates = new Set([latestGroup.keeper, ...latestGroup.duplicates].map(file => file.path))
    const selected = new Set(group.duplicates.map(file => file.path))
    return selected.size === group.duplicates.length &&
      selected.size < candidates.size &&
      group.duplicates.every(file => candidates.has(file.path) && allowed.get(file.path) === group.signature)
  })
  if (!selectionIsValid) throw new Error('The selected files do not match the latest scan.')

  const count = groups.reduce((total, group) => total + group.duplicates.length, 0)
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', `Delete ${count} file${count === 1 ? '' : 's'}`],
    defaultId: 0,
    cancelId: 0,
    title: 'Permanently delete duplicates?',
    message: `Delete ${count} newer duplicate image${count === 1 ? '' : 's'}?`,
    detail: 'This action is permanent and cannot be undone.',
    noLink: true
  })

  if (confirmation.response !== 1) return { canceled: true }
  return { canceled: false, ...(await deleteDuplicates(directory, groups)) }
})

ipcMain.handle('show-file', async (_event, filePath) => {
  if (typeof filePath === 'string' && previewableFiles.has(filePath)) shell.showItemInFolder(filePath)
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
