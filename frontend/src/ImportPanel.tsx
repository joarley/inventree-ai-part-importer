import { Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { checkPluginVersion, type InvenTreePluginContext } from '@inventreedb/ui';

import { ImportFlow } from './components/ImportFlow';

function AIPartImporterImportPanel({ context }: { context: InvenTreePluginContext }) {
  // Opens immediately when this panel is selected. There's no way for a
  // plugin panel to show a modal without its tab becoming the active one -
  // so on close, navigate back to wherever the user was before, instead of
  // leaving this tab sitting empty.
  const [opened, { close }] = useDisclosure(true);

  const handleClose = () => {
    close();
    window.history.back();
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Import via AI" size="lg">
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
