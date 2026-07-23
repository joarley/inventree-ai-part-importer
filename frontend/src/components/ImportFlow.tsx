import { useMemo, useState } from 'react';
import { Alert, Button, Card, FileInput, Group, Image, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import type { InvenTreePluginContext } from '@inventreedb/ui';

import {
  MAX_IMAGE_UPLOAD_BYTES,
  type CommitResult,
  type DraftCandidate,
  identifyPhoto,
  identifyText,
  testConnection,
} from '../api';
import { CameraCapture } from './CameraCapture';
import { CandidatePicker } from './CandidatePicker';
import { DraftReviewForm } from './DraftReviewForm';

type Step =
  | { name: 'input' }
  | { name: 'picking'; candidates: DraftCandidate[] }
  | { name: 'reviewing'; candidate: DraftCandidate }
  | { name: 'done'; result: CommitResult };

interface Props {
  context: InvenTreePluginContext;
}

/**
 * The full "identify a component, review, create the part" flow - shared by
 * the primary-action modal (Part list, Stock views) so it isn't duplicated.
 */
export function ImportFlow({ context }: Props) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'input' });

  const canIdentify = Boolean(text.trim()) || Boolean(image);
  const imagePreviewUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await testConnection(context);
      if (result.ok) {
        notifications.show({ title: 'Connection OK', message: 'The AI endpoint responded.', color: 'green' });
      } else {
        notifications.show({ title: 'Connection failed', message: result.error ?? 'Unknown error', color: 'red' });
      }
    } catch (err: any) {
      notifications.show({
        title: 'Connection failed',
        message: err?.response?.data?.error ?? 'Unknown error',
        color: 'red',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleIdentify = async () => {
    if (!canIdentify) {
      return;
    }

    if (image && image.size > MAX_IMAGE_UPLOAD_BYTES) {
      notifications.show({
        title: 'Photo too large',
        message: `Choose a photo up to ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)}MB.`,
        color: 'red',
      });
      return;
    }

    setLoading(true);
    try {
      const draft = image ? await identifyPhoto(context, image, text) : await identifyText(context, text);

      if (draft.candidates.length === 0) {
        notifications.show({
          title: 'Nothing found',
          message: 'The AI did not return any candidate with enough confidence.',
          color: 'yellow',
        });
        return;
      }

      if (draft.candidates.length === 1) {
        setStep({ name: 'reviewing', candidate: draft.candidates[0] });
      } else {
        setStep({ name: 'picking', candidates: draft.candidates });
      }
    } catch (err: any) {
      const message = err?.response?.data?.error ?? 'Failed to identify the component';
      notifications.show({ title: 'Error', message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setText('');
    setImage(null);
    setStep({ name: 'input' });
  };

  return (
    <Stack gap="sm">
      {step.name === 'input' && (
        <>
          <Button size="xs" variant="subtle" loading={testing} onClick={handleTestConnection} style={{ alignSelf: 'flex-start' }}>
            Test AI connection
          </Button>
          <Textarea
            placeholder="Describe the component, or paste the partnumber (even if partial)..."
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <FileInput
            placeholder="Or upload a photo of the component"
            accept="image/*"
            value={image}
            onChange={setImage}
            clearable
          />
          <Text size="xs" c="dimmed">
            or capture one from a camera connected to this PC:
          </Text>
          <CameraCapture onCapture={setImage} />
          {image && imagePreviewUrl && (
            <Group gap="xs">
              <Image src={imagePreviewUrl} alt="Preview" w={60} h={60} fit="contain" radius="sm" />
              <Text size="sm" c="dimmed">
                {image.name}
              </Text>
            </Group>
          )}
          <Button onClick={handleIdentify} loading={loading} disabled={!canIdentify}>
            Identify
          </Button>
        </>
      )}

      {(step.name === 'picking' || step.name === 'reviewing') && (
        <Group align="flex-start" wrap="nowrap" gap="md">
          {imagePreviewUrl && (
            <Image
              src={imagePreviewUrl}
              alt="Source"
              w={260}
              fit="contain"
              radius="sm"
              style={{ flexShrink: 0 }}
            />
          )}
          <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
            {text && (
              <Card withBorder padding="xs">
                <Text size="xs" fw={500} c="dimmed">
                  Identified from:
                </Text>
                <Text size="sm">{text}</Text>
              </Card>
            )}

            {step.name === 'picking' && (
              <CandidatePicker
                candidates={step.candidates}
                onPick={(candidate) => setStep({ name: 'reviewing', candidate })}
              />
            )}

            {step.name === 'reviewing' && (
              <DraftReviewForm
                context={context}
                candidate={step.candidate}
                onBack={reset}
                onCommitted={(result) => setStep({ name: 'done', result })}
              />
            )}
          </Stack>
        </Group>
      )}

      {step.name === 'done' && (
        <Alert color="green" title="Done">
          <Stack gap="xs">
            <Text size="sm">
              Part #{step.result.part_pk} ({step.result.part_name}) created.
            </Text>
            <Button size="xs" onClick={() => context.navigate(`/part/${step.result.part_pk}/`)}>
              View part
            </Button>
            <Button size="xs" variant="default" onClick={reset}>
              Import another
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
