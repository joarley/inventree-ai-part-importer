import { useMemo, useState } from 'react';
import { Alert, Button, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { checkPluginVersion, ModelType, type InvenTreePluginContext } from '@inventreedb/ui';

import { type CommitResult, type DraftCandidate, type EnrichDraft, enrichPart } from './api';
import { CandidatePicker } from './components/CandidatePicker';
import { DraftReviewForm } from './components/DraftReviewForm';

type Step =
  | { name: 'input' }
  | { name: 'picking'; draft: EnrichDraft }
  | { name: 'reviewing'; candidate: DraftCandidate; draft: EnrichDraft }
  | { name: 'done'; result: CommitResult };

function AIPartImporterPanel({ context }: { context: InvenTreePluginContext }) {
  const partId = useMemo(() => {
    return context.model === ModelType.part ? context.id ?? null : null;
  }, [context.model, context.id]);

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'input' });

  const handleAnalyze = async () => {
    if (!partId) {
      return;
    }

    setLoading(true);
    try {
      const draft = await enrichPart(context, Number(partId), text);

      if (draft.candidates.length === 0) {
        notifications.show({
          title: 'Nada encontrado',
          message: 'A IA não retornou nenhum candidato com confiança suficiente.',
          color: 'yellow',
        });
        return;
      }

      if (draft.candidates.length === 1) {
        setStep({ name: 'reviewing', candidate: draft.candidates[0], draft });
      } else {
        setStep({ name: 'picking', draft });
      }
    } catch (err: any) {
      const message = err?.response?.data?.error ?? 'Falha ao analisar a peça';
      notifications.show({ title: 'Erro', message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setText('');
    setStep({ name: 'input' });
  };

  if (!partId) {
    return (
      <Alert color="yellow" title="Indisponível">
        Este painel só funciona na página de detalhe de uma peça.
      </Alert>
    );
  }

  return (
    <Stack gap="sm">
      {step.name === 'input' && (
        <>
          <Text size="sm" c="dimmed">
            A IA vai olhar o nome/descrição atuais desta peça (e o texto extra abaixo, se houver)
            e sugerir dados para preencher o que estiver faltando. Nada é sobrescrito sem sua
            confirmação.
          </Text>
          <Textarea
            placeholder="Contexto adicional (opcional) - ex: partnumber que você já sabe..."
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Button onClick={handleAnalyze} loading={loading}>
            Analisar com IA
          </Button>
        </>
      )}

      {step.name === 'picking' && (
        <CandidatePicker
          candidates={step.draft.candidates}
          onPick={(candidate) => setStep({ name: 'reviewing', candidate, draft: step.draft })}
        />
      )}

      {step.name === 'reviewing' && (
        <DraftReviewForm
          context={context}
          candidate={step.candidate}
          mode="enrich"
          partPk={step.draft.part_pk}
          initialCategory={step.draft.existing_category}
          onBack={reset}
          onCommitted={(result) => setStep({ name: 'done', result })}
        />
      )}

      {step.name === 'done' && (
        <Alert color="green" title="Pronto">
          <Stack gap="xs">
            <Text size="sm">
              Peça #{step.result.part_pk} ({step.result.part_name}) atualizada.
            </Text>
            <Button size="xs" variant="default" onClick={reset}>
              Analisar de novo
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}

// This is the function which is called by InvenTree to render the actual panel component
export function RenderAIPartImporterPanel(context: InvenTreePluginContext) {
  checkPluginVersion(context);

  return <AIPartImporterPanel context={context} />;
}
