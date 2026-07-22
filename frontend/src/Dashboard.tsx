import { useState } from 'react';
import { Alert, Button, FileInput, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { checkPluginVersion, type InvenTreePluginContext } from '@inventreedb/ui';

import {
  MAX_IMAGE_UPLOAD_BYTES,
  type CommitResult,
  type DraftCandidate,
  identifyPhoto,
  identifyText,
  testConnection,
} from './api';
import { CandidatePicker } from './components/CandidatePicker';
import { DraftReviewForm } from './components/DraftReviewForm';

type Step =
  | { name: 'input' }
  | { name: 'picking'; candidates: DraftCandidate[] }
  | { name: 'reviewing'; candidate: DraftCandidate }
  | { name: 'done'; result: CommitResult };

function AIPartImporterDashboardItem({ context }: { context: InvenTreePluginContext }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'input' });

  const canIdentify = Boolean(text.trim()) || Boolean(image);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await testConnection(context);
      if (result.ok) {
        notifications.show({ title: 'Conexão OK', message: 'O endpoint de IA respondeu.', color: 'green' });
      } else {
        notifications.show({ title: 'Falha na conexão', message: result.error ?? 'Erro desconhecido', color: 'red' });
      }
    } catch (err: any) {
      notifications.show({
        title: 'Falha na conexão',
        message: err?.response?.data?.error ?? 'Erro desconhecido',
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
        title: 'Foto muito grande',
        message: `Escolha uma foto de até ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)}MB.`,
        color: 'red',
      });
      return;
    }

    setLoading(true);
    try {
      const draft = image ? await identifyPhoto(context, image, text) : await identifyText(context, text);

      if (draft.candidates.length === 0) {
        notifications.show({
          title: 'Nada encontrado',
          message: 'A IA não retornou nenhum candidato com confiança suficiente.',
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
      const message = err?.response?.data?.error ?? 'Falha ao identificar o componente';
      notifications.show({ title: 'Erro', message, color: 'red' });
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
      <Text fw={500}>Import via AI</Text>

      {step.name === 'input' && (
        <>
          <Button size="xs" variant="subtle" loading={testing} onClick={handleTestConnection} style={{ alignSelf: 'flex-start' }}>
            Testar conexão com a IA
          </Button>
          <Textarea
            placeholder="Descreva o componente, ou cole o partnumber (mesmo que parcial)..."
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <FileInput
            placeholder="Ou envie uma foto do componente"
            accept="image/*"
            value={image}
            onChange={setImage}
            clearable
          />
          <Button onClick={handleIdentify} loading={loading} disabled={!canIdentify}>
            Identificar
          </Button>
        </>
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

      {step.name === 'done' && (
        <Alert color="green" title="Pronto">
          <Stack gap="xs">
            <Text size="sm">
              Peça #{step.result.part_pk} ({step.result.part_name}) criada.
            </Text>
            <Button size="xs" onClick={() => context.navigate(`/part/${step.result.part_pk}/`)}>
              Ver peça
            </Button>
            <Button size="xs" variant="default" onClick={reset}>
              Importar outra
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}

// This is the function which is called by InvenTree to render the actual dashboard
//  component
export function RenderAIPartImporterDashboardItem(context: InvenTreePluginContext) {
  checkPluginVersion(context);
  return <AIPartImporterDashboardItem context={context} />;
}
