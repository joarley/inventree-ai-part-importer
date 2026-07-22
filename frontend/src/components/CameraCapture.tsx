import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Stack } from '@mantine/core';

interface Props {
  onCapture: (file: File) => void;
}

/**
 * Lets the user take a photo directly from a webcam attached to the PC,
 * instead of only being able to upload an already-saved file.
 */
export function CameraCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  };

  // Make sure the camera is released if the component unmounts while active
  // (e.g. the user closes the modal mid-capture).
  useEffect(() => stop, []);

  const start = async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setActive(true);
    } catch (err: any) {
      setError(err?.message ?? 'Could not access the camera');
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        }
        stop();
      },
      'image/jpeg',
      0.9,
    );
  };

  if (!active) {
    return (
      <Stack gap={4}>
        {error && (
          <Alert color="red" py={4}>
            {error}
          </Alert>
        )}
        <Button variant="default" onClick={start}>
          Use camera
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 4 }} />
      <Group>
        <Button onClick={capture}>Capture</Button>
        <Button variant="default" onClick={stop}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
