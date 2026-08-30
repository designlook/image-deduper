const elements = {
  picker: document.querySelector('#picker'),
  folderPath: document.querySelector('#folderPath'),
  chooseButton: document.querySelector('#chooseButton'),
  stopButton: document.querySelector('#stopButton'),
  subfoldersCheckbox: document.querySelector('#subfoldersCheckbox'),
  timeDifferenceCheckbox: document.querySelector('#timeDifferenceCheckbox'),
  timeDifferenceSelect: document.querySelector('#timeDifferenceSelect'),
  minSizeCheckbox: document.querySelector('#minSizeCheckbox'),
  minSizeInput: document.querySelector('#minSizeInput'),
  minSizeUnit: document.querySelector('#minSizeUnit'),
  deleteButton: document.querySelector('#deleteButton'),
  selectionActions: document.querySelector('#selectionActions'),
  selectAllCheckbox: document.querySelector('#selectAllCheckbox'),
  statusText: document.querySelector('#statusText'),
  totalImageCount: document.querySelector('#totalImageCount'),
  duplicateCount: document.querySelector('#duplicateCount'),
  spaceCount: document.querySelector('#spaceCount'),
  emptyState: document.querySelector('#emptyState'),
  results: document.querySelector('#results')
}

let selectedDirectory = null
let scanResult = null
let selectedForDeletion = new Set()
let activeScanId = null

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

function setBusy(busy, message) {
  elements.picker.classList.toggle('scanning', busy)
  elements.chooseButton.disabled = busy
  elements.chooseButton.hidden = busy
  elements.stopButton.hidden = !busy || !activeScanId
  elements.stopButton.disabled = false
  elements.subfoldersCheckbox.disabled = busy
  elements.timeDifferenceCheckbox.disabled = busy
  elements.timeDifferenceSelect.disabled = busy || !elements.timeDifferenceCheckbox.checked
  elements.minSizeCheckbox.disabled = busy
  elements.minSizeInput.disabled = busy || !elements.minSizeCheckbox.checked
  elements.minSizeUnit.disabled = busy || !elements.minSizeCheckbox.checked
  elements.deleteButton.disabled = busy || selectedForDeletion.size === 0
  if (message) elements.statusText.textContent = message
}

async function runScan() {
  if (!selectedDirectory) return
  const minSizeValue = Number(elements.minSizeInput.value)
  if (elements.minSizeCheckbox.checked && (!Number.isFinite(minSizeValue) || minSizeValue <= 0)) {
    elements.statusText.textContent = 'Enter a minimum size above zero'
    return
  }
  const minFileSizeBytes = elements.minSizeCheckbox.checked
    ? minSizeValue * (elements.minSizeUnit.value === 'MB' ? 1024 ** 2 : 1024)
    : null
  const scanId = crypto.randomUUID()
  activeScanId = scanId
  setBusy(true, 'Scanning…')
  try {
    scanResult = await window.imageDeduper.scanDirectory({
      directory: selectedDirectory,
      includeSubdirectories: elements.subfoldersCheckbox.checked,
      maxCreationDifferenceHours: elements.timeDifferenceCheckbox.checked
        ? Number(elements.timeDifferenceSelect.value)
        : null,
      minFileSizeBytes,
      scanId
    })
    renderResults(scanResult)
    elements.statusText.textContent = scanResult.stopped
      ? 'Stopped · partial results'
      : scanResult.groups.length ? 'Review results' : 'Complete'
  } catch (error) {
    elements.statusText.textContent = error.message || 'Scan failed'
  } finally {
    activeScanId = null
    setBusy(false)
  }
}

async function loadPreview(frame, filePath) {
  const source = await window.imageDeduper.imagePreview(filePath)
  if (!source || !frame.isConnected) return
  const image = document.createElement('img')
  image.className = 'preview-image'
  image.alt = ''
  image.src = source
  frame.classList.add('loaded')
  frame.append(image)
}

function updateSelectionControls() {
  const total = scanResult?.duplicateCount ?? 0
  const selected = selectedForDeletion.size
  elements.selectAllCheckbox.checked = total > 0 && selected === total
  elements.selectAllCheckbox.indeterminate = selected > 0 && selected < total
  elements.deleteButton.disabled = selected === 0
  elements.deleteButton.textContent = selected
    ? `Delete ${selected} selected ${selected === 1 ? 'copy' : 'copies'}`
    : 'Select copies to delete'
}

function fileTile(file, role) {
  const tile = document.createElement('div')
  tile.className = `file-tile ${role === 'DELETE' ? 'delete selected' : 'keep'}`

  const badge = document.createElement('span')
  badge.className = 'file-role'
  badge.textContent = role

  const preview = document.createElement('div')
  preview.className = 'preview-frame'
  loadPreview(preview, file.path)

  const info = document.createElement('div')
  info.className = 'file-info'
  const name = document.createElement('p')
  name.className = 'file-name'
  name.textContent = file.filename
  name.title = file.path
  const details = document.createElement('p')
  details.className = 'file-details'
  details.textContent = `${formatBytes(file.size)} · ${file.width}×${file.height} · ${formatDate(file.created)}`
  info.append(name, details)

  const actions = document.createElement('div')
  actions.className = 'tile-actions'
  if (role === 'DELETE') {
    const selector = document.createElement('label')
    selector.className = 'select-copy'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selectedForDeletion.has(file.path)
    const label = document.createElement('span')
    label.textContent = 'Delete this copy'
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedForDeletion.add(file.path)
      else selectedForDeletion.delete(file.path)
      tile.classList.toggle('selected', checkbox.checked)
      updateSelectionControls()
    })
    selector.append(checkbox, label)
    actions.append(selector)
  } else {
    const protectedLabel = document.createElement('span')
    protectedLabel.className = 'file-details'
    protectedLabel.textContent = 'Protected'
    actions.append(protectedLabel)
  }
  const reveal = document.createElement('button')
  reveal.className = 'show-file'
  reveal.textContent = 'Show file'
  reveal.addEventListener('click', () => window.imageDeduper.showFile(file.path))
  actions.append(reveal)
  tile.append(badge, preview, info, actions)
  return tile
}

function renderResults(result) {
  elements.totalImageCount.textContent = result.totalImages.toLocaleString()
  elements.duplicateCount.textContent = result.duplicateCount.toLocaleString()
  elements.spaceCount.textContent = formatBytes(result.reclaimableBytes)
  elements.results.replaceChildren()
  selectedForDeletion = new Set(result.groups.flatMap(group => group.duplicates.map(file => file.path)))

  if (!result.groups.length) {
    elements.results.hidden = true
    elements.emptyState.hidden = false
    elements.emptyState.querySelector('p').textContent = result.stopped ? 'Scan stopped.' : 'No newer duplicates found.'
    elements.emptyState.querySelector('span').textContent = result.stopped
      ? `${result.totalImages} image${result.totalImages === 1 ? '' : 's'} checked.`
      : result.skipped
      ? `${result.skipped} unreadable or unsupported image${result.skipped === 1 ? ' was' : 's were'} skipped.`
      : result.filteredOut
      ? `${result.filteredOut} image${result.filteredOut === 1 ? ' was' : 's were'} below the minimum size.`
      : 'This folder is already tidy.'
    elements.selectionActions.hidden = true
    return
  }

  elements.emptyState.hidden = true
  elements.results.hidden = false
  elements.selectionActions.hidden = false
  updateSelectionControls()

  for (const group of result.groups) {
    const card = document.createElement('article')
    card.className = 'result-group'
    const meta = document.createElement('div')
    meta.className = 'group-meta'
    meta.innerHTML = `<span>${group.keeper.width} × ${group.keeper.height} PX</span><span>${formatBytes(group.keeper.size)} EACH</span>`
    const strip = document.createElement('div')
    strip.className = 'comparison-strip'
    strip.append(fileTile(group.keeper, 'KEEP'))
    for (const duplicate of group.duplicates) strip.append(fileTile(duplicate, 'DELETE'))
    card.append(meta, strip)
    elements.results.append(card)
  }
}

elements.chooseButton.addEventListener('click', async () => {
  const directory = await window.imageDeduper.chooseDirectory()
  if (!directory) return
  selectedDirectory = directory
  scanResult = null
  elements.folderPath.textContent = directory
  elements.folderPath.title = directory
  elements.statusText.textContent = 'Scanning…'
  elements.totalImageCount.textContent = '—'
  elements.duplicateCount.textContent = '—'
  elements.spaceCount.textContent = '—'
  elements.selectionActions.hidden = true
  await runScan()
})

elements.selectAllCheckbox.addEventListener('change', () => {
  selectedForDeletion = elements.selectAllCheckbox.checked
    ? new Set(scanResult.groups.flatMap(group => group.duplicates.map(file => file.path)))
    : new Set()
  elements.results.querySelectorAll('.file-tile.delete').forEach(tile => tile.classList.toggle('selected', elements.selectAllCheckbox.checked))
  elements.results.querySelectorAll('.select-copy input').forEach(checkbox => { checkbox.checked = elements.selectAllCheckbox.checked })
  updateSelectionControls()
})

elements.subfoldersCheckbox.addEventListener('change', runScan)
elements.timeDifferenceCheckbox.addEventListener('change', () => {
  elements.timeDifferenceSelect.disabled = !elements.timeDifferenceCheckbox.checked
  runScan()
})
elements.timeDifferenceSelect.addEventListener('change', runScan)
elements.minSizeCheckbox.addEventListener('change', () => {
  elements.minSizeInput.disabled = !elements.minSizeCheckbox.checked
  elements.minSizeUnit.disabled = !elements.minSizeCheckbox.checked
  runScan()
})
elements.minSizeInput.addEventListener('change', runScan)
elements.minSizeUnit.addEventListener('change', runScan)

elements.stopButton.addEventListener('click', async () => {
  if (!activeScanId) return
  elements.stopButton.disabled = true
  elements.statusText.textContent = 'Stopping…'
  await window.imageDeduper.stopScan(activeScanId)
})

elements.deleteButton.addEventListener('click', async () => {
  if (!scanResult) return
  setBusy(true, 'Waiting for confirmation…')
  try {
    const selectedGroups = scanResult.groups
      .map(group => ({ ...group, duplicates: group.duplicates.filter(file => selectedForDeletion.has(file.path)) }))
      .filter(group => group.duplicates.length)
    const result = await window.imageDeduper.deleteDuplicates({
      directory: selectedDirectory,
      groups: selectedGroups
    })
    if (result.canceled) {
      elements.statusText.textContent = 'Deletion canceled'
      return
    }
    elements.statusText.textContent = result.failures.length
      ? `Deleted ${result.deleted}; ${result.failures.length} failed`
      : `Deleted ${result.deleted} · freed ${formatBytes(result.bytesFreed)}`
    scanResult = await window.imageDeduper.scanDirectory({
      directory: selectedDirectory,
      includeSubdirectories: elements.subfoldersCheckbox.checked,
      maxCreationDifferenceHours: elements.timeDifferenceCheckbox.checked
        ? Number(elements.timeDifferenceSelect.value)
        : null,
      minFileSizeBytes: elements.minSizeCheckbox.checked
        ? Number(elements.minSizeInput.value) * (elements.minSizeUnit.value === 'MB' ? 1024 ** 2 : 1024)
        : null,
      scanId: crypto.randomUUID()
    })
    renderResults(scanResult)
  } catch (error) {
    elements.statusText.textContent = error.message || 'Deletion failed'
  } finally {
    setBusy(false)
  }
})
