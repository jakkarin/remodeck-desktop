import { app, dialog, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createApp } from './app'
import { registerHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null
let disposeApp: (() => Promise<void>) | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    // Only hand https links to the OS; never file:, custom protocols or plain http.
    let protocol = ''
    try {
      protocol = new URL(details.url).protocol
    } catch {
      /* unparsable: ignore */
    }
    if (protocol === 'https:') void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('dev.regit.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    const regit = await createApp({
      dataDir: join(app.getPath('appData'), 'regit'),
      window: () => mainWindow
    })
    disposeApp = regit.dispose
    registerHandlers(ipcMain, regit.api)
  } catch (err) {
    dialog.showErrorBox('regit', `เริ่มแอปไม่สำเร็จ\n${(err as Error).message}`)
    app.exit(1)
    return
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Stop the git bridge and close terminals before quitting.
app.on('will-quit', (event) => {
  const dispose = disposeApp
  if (!dispose) return
  disposeApp = null
  event.preventDefault()
  dispose()
    .catch((err) => console.error('[regit] dispose failed:', err))
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
