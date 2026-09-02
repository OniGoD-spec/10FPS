const {app, BrowserWindow, dialog, ipcMain} = require('electron');
const express = require('express');
const {createServer} = require('node:http');
const {createWriteStream} = require('node:fs');
const {copyFile, mkdir, open, rm, stat} = require('node:fs/promises');
const {pipeline} = require('node:stream/promises');
const {randomUUID} = require('node:crypto');
const path = require('node:path');
const yauzl = require('yauzl');

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
const MAX_FRAMES = 100000;
const MAX_ZIP_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024 * 1024;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024 * 1024;
const naturalCollator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

let server;
let serverOrigin;
let jobsRoot;
const jobs = new Map();
const saves = new Map();

const safeMessage = (error) => (error instanceof Error ? error.message : String(error));

const cleanupJob = async (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.delete(jobId);
  await rm(job.dir, {recursive: true, force: true});
};

const cleanupAll = async () => {
  for (const [saveId, save] of saves) {
    saves.delete(saveId);
    try {
      await save.fileHandle.close();
    } catch {}
  }
  for (const jobId of [...jobs.keys()]) {
    try {
      await cleanupJob(jobId);
    } catch {}
  }
};

const startLocalServer = async () => {
  jobsRoot = path.join(app.getPath('temp'), 'FrameRunner', 'jobs');
  await mkdir(jobsRoot, {recursive: true});

  const web = express();
  web.disable('x-powered-by');
  web.use('/frames', express.static(jobsRoot, {fallthrough: false, immutable: true, maxAge: '1h'}));
  web.use(express.static(path.join(app.getAppPath(), 'dist'), {index: 'index.html'}));

  server = createServer(web);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local Frame Runner server.');
  serverOrigin = `http://127.0.0.1:${address.port}`;
};

const extractZip = async (zipPath) => {
  const zipStats = await stat(zipPath);
  if (zipStats.size > MAX_ZIP_BYTES) {
    throw new Error('ZIP is larger than the 8 GB desktop safety limit.');
  }

  const archive = await yauzl.openPromise(zipPath, {
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: false,
  });

  try {
    const entries = [];
    let totalUncompressedBytes = 0;

    for await (const entry of archive.eachEntry()) {
      if (entry.fileName.endsWith('/')) continue;
      if (entry.fileName.split('/').includes('__MACOSX')) continue;
      if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.fileName).toLowerCase())) continue;

      totalUncompressedBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('The extracted image data exceeds the 32 GB desktop safety limit.');
      }

      entries.push(entry);
      if (entries.length > MAX_FRAMES) {
        throw new Error(`The ZIP contains more than ${MAX_FRAMES.toLocaleString()} supported image frames.`);
      }
    }

    entries.sort((a, b) => naturalCollator.compare(a.fileName, b.fileName));

    if (entries.length === 0) {
      throw new Error('The ZIP contains no PNG, JPG, JPEG, or WebP images.');
    }

    const jobId = randomUUID();
    const jobDir = path.join(jobsRoot, jobId);
    const frameDir = path.join(jobDir, 'frames');
    await mkdir(frameDir, {recursive: true});

    try {
      const frameFiles = [];
      const originalNames = [];

      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const extension = path.extname(entry.fileName).toLowerCase();
        const frameFile = `frame-${String(index + 1).padStart(8, '0')}${extension}`;
        const readStream = await archive.openReadStreamPromise(entry);
        await pipeline(readStream, createWriteStream(path.join(frameDir, frameFile)));
        frameFiles.push(frameFile);
        originalNames.push(entry.fileName);
      }

      const job = {id: jobId, dir: jobDir};
      jobs.set(jobId, job);
      return {
        cancelled: false,
        jobId,
        zipName: path.basename(zipPath),
        frameCount: frameFiles.length,
        frames: frameFiles.map((file) => `${serverOrigin}/frames/${jobId}/frames/${encodeURIComponent(file)}`),
        firstName: originalNames[0],
        lastName: originalNames[originalNames.length - 1],
      };
    } catch (error) {
      await rm(jobDir, {recursive: true, force: true});
      throw error;
    }
  } finally {
    archive.close();
  }
};

const pickAudioForJob = async (jobId) => {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Choose an image ZIP before adding audio.');

  const result = await dialog.showOpenDialog({
    title: 'Choose soundtrack',
    properties: ['openFile'],
    filters: [
      {name: 'Audio files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']},
      {name: 'All files', extensions: ['*']},
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return {cancelled: true};

  const audioPath = result.filePaths[0];
  const extension = path.extname(audioPath).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported audio format. Use MP3, WAV, M4A, AAC, OGG, or FLAC.');
  }

  const audioStats = await stat(audioPath);
  if (audioStats.size > MAX_AUDIO_BYTES) {
    throw new Error('Audio file is larger than the 4 GB desktop safety limit.');
  }

  const audioDir = path.join(job.dir, 'audio');
  await rm(audioDir, {recursive: true, force: true});
  await mkdir(audioDir, {recursive: true});
  const audioFile = `soundtrack${extension}`;
  await copyFile(audioPath, path.join(audioDir, audioFile));

  return {
    cancelled: false,
    name: path.basename(audioPath),
    url: `${serverOrigin}/frames/${jobId}/audio/${encodeURIComponent(audioFile)}`,
  };
};

const registerIpc = () => {
  ipcMain.handle('frame-runner:pick-zip', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose image ZIP',
      properties: ['openFile'],
      filters: [{name: 'ZIP archives', extensions: ['zip']}],
    });
    if (result.canceled || result.filePaths.length === 0) return {cancelled: true};
    try {
      return await extractZip(result.filePaths[0]);
    } catch (error) {
      throw new Error(`Could not open ZIP: ${safeMessage(error)}`);
    }
  });

  ipcMain.handle('frame-runner:pick-audio', async (_event, jobId) => {
    if (typeof jobId !== 'string') throw new Error('Invalid image job.');
    try {
      return await pickAudioForJob(jobId);
    } catch (error) {
      throw new Error(`Could not add audio: ${safeMessage(error)}`);
    }
  });

  ipcMain.handle('frame-runner:clear-audio', async (_event, jobId) => {
    if (typeof jobId !== 'string') return;
    const job = jobs.get(jobId);
    if (!job) return;
    await rm(path.join(job.dir, 'audio'), {recursive: true, force: true});
  });

  ipcMain.handle('frame-runner:release-job', async (_event, jobId) => {
    if (typeof jobId !== 'string') return;
    await cleanupJob(jobId);
  });

  ipcMain.handle('frame-runner:begin-save', async (_event, suggestedName) => {
    const safeName = path.basename(typeof suggestedName === 'string' ? suggestedName : 'image-sequence.mp4');
    const filename = safeName.toLowerCase().endsWith('.mp4') ? safeName : `${safeName}.mp4`;
    const result = await dialog.showSaveDialog({
      title: 'Save rendered MP4',
      defaultPath: path.join(app.getPath('videos'), filename),
      filters: [{name: 'MP4 video', extensions: ['mp4']}],
    });
    if (result.canceled || !result.filePath) return {cancelled: true};

    const saveId = randomUUID();
    const fileHandle = await open(result.filePath, 'w');
    saves.set(saveId, {fileHandle, filePath: result.filePath});
    return {cancelled: false, saveId, path: result.filePath};
  });

  ipcMain.handle('frame-runner:write-chunk', async (_event, payload) => {
    const save = saves.get(payload?.saveId);
    if (!save) throw new Error('The output file is no longer available.');
    const position = Number(payload?.position);
    if (!Number.isSafeInteger(position) || position < 0) throw new Error('Invalid output chunk position.');
    const bytes = Buffer.from(payload.data);
    await save.fileHandle.write(bytes, 0, bytes.length, position);
  });

  ipcMain.handle('frame-runner:finish-save', async (_event, saveId) => {
    const save = saves.get(saveId);
    if (!save) return;
    saves.delete(saveId);
    await save.fileHandle.close();
  });

  ipcMain.handle('frame-runner:cancel-save', async (_event, saveId) => {
    const save = saves.get(saveId);
    if (!save) return;
    saves.delete(saveId);
    try {
      await save.fileHandle.close();
    } finally {
      await rm(save.filePath, {force: true});
    }
  });
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 880,
    minHeight: 650,
    backgroundColor: '#090b10',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  await window.loadURL(serverOrigin);
};

app.setAppUserModelId('com.framerunner.desktop');

app.whenReady().then(async () => {
  try {
    await startLocalServer();
    registerIpc();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('Frame Runner could not start', safeMessage(error));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
  void cleanupAll();
});
