import React from 'react';
import {Audio} from '@remotion/media';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';

export type ImageSequenceProps = {
  frames: string[];
  fit: 'contain' | 'cover';
  backgroundColor: string;
  audioSrc: string | null;
  audioVolume: number;
  audioLoop: boolean;
};

export const ImageSequence: React.FC<ImageSequenceProps> = ({
  frames,
  fit,
  backgroundColor,
  audioSrc,
  audioVolume,
  audioLoop,
}) => {
  const frame = useCurrentFrame();
  const src = frames[Math.min(frame, Math.max(0, frames.length - 1))];

  return (
    <AbsoluteFill style={{backgroundColor}}>
      {src ? (
        <Img
          src={src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            display: 'block',
          }}
        />
      ) : null}
      {audioSrc ? <Audio src={audioSrc} volume={audioVolume} loop={audioLoop} /> : null}
    </AbsoluteFill>
  );
};
