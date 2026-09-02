export {};

type PickZipResult =
  | {cancelled: true}
  | {
      cancelled: false;
      jobId: string;
      zipName: string;
      frameCount: number;
      frames: string[];
      firstName: string;
      lastName: string;
    };

type PickAudioResult =
  | {cancelled: true}
  | {cancelled: false; name: string; url: string};

type BeginSaveResult =
  | {cancelled: true}
  | {cancelled: false; saveId: string; path: string};

declare global {
  interface Window {
    frameRunner: {
      pickZip: () => Promise<PickZipResult>;
      pickAudio: (jobId: string) => Promise<PickAudioResult>;
      clearAudio: (jobId: string) => Promise<void>;
      releaseJob: (jobId: string) => Promise<void>;
      beginSave: (suggestedName: string) => Promise<BeginSaveResult>;
      writeChunk: (saveId: string, position: number, data: ArrayBuffer) => Promise<void>;
      finishSave: (saveId: string) => Promise<void>;
      cancelSave: (saveId: string) => Promise<void>;
    };
  }
}
