import { Badge } from '@mantine/core';

const LABELS: Record<string, string> = {
  ai: 'AI',
  'official:digikey': 'DigiKey',
  'official:mouser': 'Mouser',
  'official:datasheets.com': 'Datasheets.com',
  user: 'Edited',
  existing: 'Current',
};

const COLORS: Record<string, string> = {
  ai: 'yellow',
  'official:digikey': 'red',
  'official:mouser': 'blue',
  'official:datasheets.com': 'grape',
  user: 'gray',
  existing: 'teal',
};

export function SourceBadge({ source }: { source?: string }) {
  if (!source) {
    return null;
  }

  return (
    <Badge color={COLORS[source] ?? 'gray'} size="sm" variant="light">
      {LABELS[source] ?? source}
    </Badge>
  );
}
