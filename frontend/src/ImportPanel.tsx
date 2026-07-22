import { Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { checkPluginVersion, type InvenTreePluginContext } from '@inventreedb/ui';

import { ImportFlow } from './components/ImportFlow';

function AIPartImporterImportPanel({ context }: { context: InvenTreePluginContext }) {
  // Opens immediately when this panel is selected - closing it just leaves
  // the tab empty; re-selecting the tab (or navigating back to it) opens it
  // again since the component remounts fresh.
  const [opened, { close }] = useDisclosure(true);

  return (
    <Modal opened={opened} onClose={close} title="Import via AI" size="lg">
      <ImportFlow context={context} />
    </Modal>
  );
}

// This is the function which is called by InvenTree to render the actual
// panel component - shown as a tab when browsing Parts or Stock locations.
export function RenderAIPartImporterImportPanel(context: InvenTreePluginContext) {
  checkPluginVersion(context);
  return <AIPartImporterImportPanel context={context} />;
}
