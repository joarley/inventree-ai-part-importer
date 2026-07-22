import { Button, Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { checkPluginVersion, type InvenTreePluginContext } from '@inventreedb/ui';

import { ImportFlow } from './components/ImportFlow';

function AIPartImporterAction({ context }: { context: InvenTreePluginContext }) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Modal opened={opened} onClose={close} title="Import via AI" size="lg">
        <ImportFlow context={context} />
      </Modal>
      <Button size="xs" variant="light" onClick={open}>
        Import via AI
      </Button>
    </>
  );
}

// This is the function which is called by InvenTree to render the actual
// primary action button (shown in the page header, e.g. on the Part list).
export function RenderAIPartImporterAction(context: InvenTreePluginContext) {
  checkPluginVersion(context);
  return <AIPartImporterAction context={context} />;
}
