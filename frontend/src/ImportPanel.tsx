import { checkPluginVersion, type InvenTreePluginContext } from '@inventreedb/ui';

import { ImportFlow } from './components/ImportFlow';

// This is the function which is called by InvenTree to render the actual
// panel component - shown as a tab when browsing Parts or Stock locations.
export function RenderAIPartImporterImportPanel(context: InvenTreePluginContext) {
  checkPluginVersion(context);
  return <ImportFlow context={context} />;
}
