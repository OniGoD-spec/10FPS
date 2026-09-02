import React, {useMemo, useState} from 'react';
import {Player} from '@remotion/player';
import {renderMediaOnWeb} from '@remotion/web-renderer';
import {ImageSequence, type ImageSequenceProps} from './remotion/ImageSequence';

type UploadJob = {
  jobId: string;
  zipName: string;
  frameCount: number;
  frames: string[];
  firstName: string;
  lastName: string;
};

type Resolution = {
  label: string;
  width: number;
  height: number;
};

type RenderState =
  | {status: 'idle'; progress: 0}
  | {status: 'rendering'; progress: number; estimatedMs: number | null}
  | {status: 'done'; progress: 1; outputPath: string}
  | {status: 'error'; progress: 0; error: string};

const resolutions: Resolution[] = [
  {label: '1080p Landscape', width: 1920, height: 1080},
  {label: '720p Landscape', width: 1280, height: 720},
  {label: '1080 Square', width: 1080, height: 1080},
  {label: '1080p Vertical', width: 1080, height: 1920},
  {label: '4K Landscape', width: 3840, height: 2160},
];

const formatDuration = (seconds: number) => {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const formatEta = (milliseconds: number | null) => {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return 'Estimating…';
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `About ${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} min left`;
};

const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const App: React.FC = () => {
  const [job, setJob] = useState<UploadJob | null>(null);
  const [fps, setFps] = useState(24);
  const [resolutionIndex, setResolutionIndex] = useState(0);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [loadingZip, setLoadingZip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [render, setRender] = useState<RenderState>({status: 'idle', progress: 0});

  const resolution = resolutions[resolutionIndex];
  const duration = job ? job.frameCount / fps : 0;
  const renderActive = render.status === 'rendering';

  const inputProps = useMemo<ImageSequenceProps>(
    () => ({
      frames: job?.frames ?? [],
      fit,
      backgroundColor: '#000000',
    }),
    [job, fit],
  );

  const chooseZip = async () => {
    if (!window.frameRunner) {
      setError('Desktop bridge is unavailable. Launch the installed Frame Runner app instead of opening the web files directly.');
      return;
    }

    setLoadingZip(true);
    setError(null);
    try {
      const picked = await window.frameRunner.pickZip();
      if (picked.cancelled) return;
      if (job) await window.frameRunner.releaseJob(job.jobId);
      setJob(picked);
      setRender({status: 'idle', progress: 0});
    } catch (pickError) {
      setError(safeError(pickError));
    } finally {
      setLoadingZip(false);
    }
  };

  const reset = async () => {
    if (job && !renderActive) {
      try {
        await window.frameRunner.releaseJob(job.jobId);
      } catch {
        // Best-effort cleanup only.
      }
    }
    setJob(null);
    setRender({status: 'idle', progress: 0});
    setError(null);
  };

  const startRender = async () => {
    if (!job || renderActive) return;

    const baseName = job.zipName.replace(/\.zip$/i, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'image-sequence';
    const suggestedName = `${baseName}-${fps}fps.mp4`;
    const save = await window.frameRunner.beginSave(suggestedName);
    if (save.cancelled) return;

    setError(null);
    setRender({status: 'rendering', progress: 0, estimatedMs: null});

    let saveFinished = false;
    const outputWritable = new WritableStream<{data: Uint8Array; position: number}>({
      write: async (chunk) => {
        const bytes = chunk.data;
        const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        await window.frameRunner.writeChunk(save.saveId, chunk.position, copied);
      },
      close: async () => {
        await window.frameRunner.finishSave(save.saveId);
        saveFinished = true;
      },
      abort: async () => {
        await window.frameRunner.cancelSave(save.saveId);
        saveFinished = true;
      },
    });

    try {
      await renderMediaOnWeb({
        composition: {
          id: 'ImageSequence',
          component: ImageSequence,
          durationInFrames: Math.max(1, job.frameCount),
          fps,
          width: resolution.width,
          height: resolution.height,
          defaultProps: inputProps,
        },
        inputProps,
        container: 'mp4',
        videoCodec: 'h264',
        muted: true,
        videoBitrate: 'high',
        hardwareAcceleration: 'no-preference',
        pageResponsiveness: 'medium',
        outputWritable,
        onProgress: ({progress, renderEstimatedTime}) => {
          setRender({
            status: 'rendering',
            progress: Math.max(0, Math.min(1, progress)),
            estimatedMs: renderEstimatedTime,
          });
        },
      });

      if (!saveFinished) {
        await window.frameRunner.finishSave(save.saveId);
        saveFinished = true;
      }
      setRender({status: 'done', progress: 1, outputPath: save.path});
    } catch (renderError) {
      if (!saveFinished) {
        try {
          await window.frameRunner.cancelSave(save.saveId);
        } catch {
          // Preserve the original render error.
        }
      }
      setRender({status: 'error', progress: 0, error: safeError(renderError)});
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">DESKTOP VIDEO UTILITY</p>
          <h1>Frame Runner</h1>
          <p className="subtitle">Choose an image ZIP, set FPS, preview the sequence, and save a real MP4. One image equals one frame.</p>
        </div>
        {job ? (
          <button className="ghost-button" type="button" onClick={reset} disabled={renderActive}>
            New ZIP
          </button>
        ) : null}
      </header>

      {!job ? (
        <section className="drop-zone">
          <div className="drop-icon" aria-hidden="true">ZIP</div>
          <h2>{loadingZip ? 'Extracting frames…' : 'Choose your image ZIP'}</h2>
          <p>PNG, JPG, JPEG, and WebP files are natural-sorted by filename. Nothing is uploaded to the internet.</p>
          <button className="primary-button" type="button" disabled={loadingZip} onClick={() => void chooseZip()}>
            {loadingZip ? 'Processing…' : 'Choose ZIP'}
          </button>
        </section>
      ) : (
        <div className="workspace">
          <section className="preview-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PREVIEW</p>
                <h2>Image sequence</h2>
              </div>
              <span className="status-pill">{job.frameCount.toLocaleString()} frames</span>
            </div>

            <div className="player-wrap">
              <Player
                component={ImageSequence}
                inputProps={inputProps}
                durationInFrames={Math.max(1, job.frameCount)}
                fps={fps}
                compositionWidth={resolution.width}
                compositionHeight={resolution.height}
                controls
                style={{width: '100%', aspectRatio: `${resolution.width} / ${resolution.height}`}}
              />
            </div>

            <div className="sequence-meta">
              <div>
                <span>First</span>
                <strong title={job.firstName}>{job.firstName}</strong>
              </div>
              <div>
                <span>Last</span>
                <strong title={job.lastName}>{job.lastName}</strong>
              </div>
            </div>
          </section>

          <aside className="controls-panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">OUTPUT</p>
                <h2>Render settings</h2>
              </div>
            </div>

            <label className="field">
              <span>Frames per second</span>
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                value={fps}
                disabled={renderActive}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) setFps(Math.min(120, Math.max(1, Math.round(value))));
                }}
              />
            </label>

            <div className="fps-presets" aria-label="FPS presets">
              {[10, 12, 24, 30, 60].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={fps === value ? 'preset active' : 'preset'}
                  disabled={renderActive}
                  onClick={() => setFps(value)}
                >
                  {value}
                </button>
              ))}
            </div>

            <label className="field">
              <span>Resolution</span>
              <select value={resolutionIndex} disabled={renderActive} onChange={(event) => setResolutionIndex(Number(event.target.value))}>
                {resolutions.map((item, index) => (
                  <option key={item.label} value={index}>
                    {item.label} · {item.width}×{item.height}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Image fit</span>
              <select value={fit} disabled={renderActive} onChange={(event) => setFit(event.target.value as 'contain' | 'cover')}>
                <option value="contain">Contain · show whole image</option>
                <option value="cover">Cover · fill and crop</option>
              </select>
            </label>

            <div className="stats-grid">
              <div>
                <span>Frames</span>
                <strong>{job.frameCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>Duration</span>
                <strong>{formatDuration(duration)}</strong>
              </div>
              <div>
                <span>FPS</span>
                <strong>{fps}</strong>
              </div>
              <div>
                <span>Output</span>
                <strong>{resolution.width}×{resolution.height}</strong>
              </div>
            </div>

            {render.status === 'rendering' ? (
              <div className="render-progress" aria-live="polite">
                <div className="progress-copy">
                  <span>{formatEta(render.estimatedMs)}</span>
                  <strong>{Math.round(render.progress * 100)}%</strong>
                </div>
                <div className="progress-track"><div className="progress-fill" style={{width: `${render.progress * 100}%`}} /></div>
              </div>
            ) : null}

            {render.status === 'error' ? <p className="error-box">{render.error}</p> : null}
            {render.status === 'done' ? (
              <div className="success-box">
                <strong>MP4 saved</strong>
                <span title={render.outputPath}>{render.outputPath}</span>
              </div>
            ) : null}

            <button className="render-button" type="button" disabled={renderActive} onClick={() => void startRender()}>
              {renderActive ? 'Rendering…' : 'Render & Save MP4'}
            </button>

            <p className="fine-print">Changing FPS changes playback speed and duration. Rendering happens locally on this computer.</p>
          </aside>
        </div>
      )}

      {error ? <p className="error-box global-error">{error}</p> : null}
    </main>
  );
};
