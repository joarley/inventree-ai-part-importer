import { Button, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { checkPluginVersion, type InvenTreePluginContext } from '@inventreedb/ui';

import { ImportFlow } from './components/ImportFlow';

function AIPartImporterImportPanel({ context }: { context: InvenTreePluginContext }) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <Stack gap="sm">
      <Modal opened={opened} onClose={close} title="Import via AI" size="lg">
        <ImportFlow context={context} />
      </Modal>
      <Text size="sm" c="dimmed">
        Identify a component from text or a photo, then review and create it as a Part.
      </Text>
      <Button onClick={open} style={{ alignSelf: 'flex-start' }}>
        Import via AI
      </Button>
    </Stack>
  );
}

// This is the function which is called by InvenTree to render the actual
// panel component - shown as a tab when browsing Parts or Stock locations.
export function RenderAIPartImporterImportPanel(context: InvenTreePluginContext) {
  checkPluginVersion(context);
  return <AIPartImporterImportPanel context={context} />;
}
