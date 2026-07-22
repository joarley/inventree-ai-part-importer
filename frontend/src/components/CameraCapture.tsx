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
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Attaches the stream to the <video> element once it actually exists in
  // the DOM (it only mounts once `stream` is set, so this can't run any
  // earlier), and releases the camera whenever the stream changes or this
  // component unmounts.
  useEffect(() => {
    if (!stream) {
      return;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }

    return () => {
      stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const start = async () => {
    setError(null);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(newStream);
    } catch (err: any) {
      setError(err?.message ?? 'Could not access the camera');
    }
  };

  const stop = () => {
    setStream(null);
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

  if (!stream) {
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
