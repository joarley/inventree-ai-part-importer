import { Button, Card, Group, Stack, Text } from '@mantine/core';

import type { DraftCandidate } from '../api';

interface Props {
  candidates: DraftCandidate[];
  onPick: (candidate: DraftCandidate) => void;
}

export function CandidatePicker({ candidates, onPick }: Props) {
  return (
    <Stack gap="xs">
      <Text size="sm">A IA encontrou mais de uma possibilidade - escolha uma:</Text>
      {candidates.map((c, index) => (
        <Card key={index} withBorder padding="sm">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text fw={500}>{c.name?.value || '(sem nome)'}</Text>
              <Text size="sm" c="dimmed">
                {c.manufacturer?.value} {c.mpn?.value ? `- ${c.mpn?.value}` : ''}
              </Text>
              <Text size="xs" c="dimmed">
                Confiança: {Math.round((c.confidence ?? 0) * 100)}%
              </Text>
            </Stack>
            <Button size="xs" onClick={() => onPick(c)}>
              Escolher
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
