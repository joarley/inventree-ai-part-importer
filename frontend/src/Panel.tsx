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
          title: 'Nothing found',
          message: 'The AI did not return any candidate with enough confidence.',
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
      const message = err?.response?.data?.error ?? 'Failed to analyze the part';
      notifications.show({ title: 'Error', message, color: 'red' });
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
      <Alert color="yellow" title="Unavailable">
        This panel only works on a part's detail page.
      </Alert>
    );
  }

  return (
    <Stack gap="sm">
      {step.name === 'input' && (
        <>
          <Text size="sm" c="dimmed">
            The AI will look at this part's current name/description (and the extra text below,
            if any) and suggest data to fill in whatever is missing. Nothing is overwritten
            without your confirmation.
          </Text>
          <Textarea
            placeholder="Additional context (optional) - e.g. a partnumber you already know..."
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Button onClick={handleAnalyze} loading={loading}>
            Analyze with AI
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
        <Alert color="green" title="Done">
          <Stack gap="xs">
            <Text size="sm">
              Part #{step.result.part_pk} ({step.result.part_name}) updated.
            </Text>
            <Button size="xs" variant="default" onClick={reset}>
              Analyze again
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
