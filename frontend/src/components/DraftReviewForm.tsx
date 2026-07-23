import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Collapse,
  Group,
  Image,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import type { InvenTreePluginContext } from '@inventreedb/ui';

import {
  type CategoryMatch,
  type CommitResult,
  type DatasheetAction,
  type DraftCandidate,
  type ParameterEntry,
  type SupplierLink,
  commitDraft,
  searchCategories,
} from '../api';
import { SourceBadge } from './SourceBadge';

interface Props {
  context: InvenTreePluginContext;
  candidate: DraftCandidate;
  onCommitted: (result: CommitResult) => void;
  onBack: () => void;
  mode?: 'create' | 'enrich';
  partPk?: number;
  initialCategory?: CategoryMatch | null;
}

export function DraftReviewForm({
  context,
  candidate,
  onCommitted,
  onBack,
  mode = 'create',
  partPk,
  initialCategory = null,
}: Props) {
  const [name, setName] = useState(candidate.name?.value ?? '');
  const [description, setDescription] = useState(candidate.description?.value ?? '');
  const [manufacturer, setManufacturer] = useState(candidate.manufacturer?.value ?? '');
  const [mpn, setMpn] = useState(candidate.mpn?.value ?? '');

  const [categorySearch, setCategorySearch] = useState(
    initialCategory?.pathstring ?? candidate.category_guess?.path ?? '',
  );
  const [debouncedCategorySearch] = useDebouncedValue(categorySearch, 300);
  const [categoryResults, setCategoryResults] = useState<CategoryMatch[]>([]);
  const [category, setCategory] = useState<CategoryMatch | null>(initialCategory);
  const [searching, setSearching] = useState(false);

  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<string>>(
    new Set((candidate.supplier_links ?? []).map((l) => l.supplier)),
  );
  const [datasheetAction, setDatasheetAction] = useState<DatasheetAction>(
    candidate.datasheet_url ? 'link_only' : 'skip',
  );
  const [useOfficialImage, setUseOfficialImage] = useState(Boolean(candidate.image_url));

  const [selectedParameters, setSelectedParameters] = useState<Set<string>>(
    new Set((candidate.parameters ?? []).map((p) => p.name)),
  );
  const [parametersOpened, { toggle: toggleParametersOpened }] = useDisclosure(false);

  const [submitting, setSubmitting] = useState(false);

  const canCommit = Boolean(name.trim()) && Boolean(category) && Boolean(manufacturer.trim() || mpn.trim());

  const toggleSupplier = (supplier: string) => {
    setSelectedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) {
        next.delete(supplier);
      } else {
        next.add(supplier);
      }
      return next;
    });
  };

  const toggleParameter = (name: string) => {
    setSelectedParameters((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const allParameterNames = (candidate.parameters ?? []).map((p) => p.name);
  const allParametersSelected =
    allParameterNames.length > 0 && allParameterNames.every((n) => selectedParameters.has(n));
  const someParametersSelected = allParameterNames.some((n) => selectedParameters.has(n));

  const toggleAllParameters = () => {
    setSelectedParameters(allParametersSelected ? new Set() : new Set(allParameterNames));
  };

  // Keep the currently-selected category visible in the dropdown even if a
  // new search's results don't happen to include it anymore.
  const categoryOptions =
    category && !categoryResults.some((c) => c.pk === category.pk)
      ? [category, ...categoryResults]
      : categoryResults;

  // Runs on mount (so there's something to pick from immediately, without
  // typing anything first) and again whenever the search text settles.
  useEffect(() => {
    let cancelled = false;

    setSearching(true);
    searchCategories(context, debouncedCategorySearch)
      .then((results) => {
        if (!cancelled) {
          setCategoryResults(results);
        }
      })
      .catch(() => {
        if (!cancelled) {
          notifications.show({ title: 'Error', message: 'Failed to search categories', color: 'red' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearching(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCategorySearch]);

  const handleCommit = async () => {
    if (!category) {
      return;
    }

    setSubmitting(true);
    try {
      const supplierLinks: SupplierLink[] = (candidate.supplier_links ?? []).filter((l) =>
        selectedSuppliers.has(l.supplier),
      );

      const parameters: ParameterEntry[] = (candidate.parameters ?? []).filter((p) =>
        selectedParameters.has(p.name),
      );

      const result = await commitDraft(
        context,
        category.pk,
        {
          name: { value: name, source: 'user' },
          description: { value: description, source: 'user' },
          manufacturer: manufacturer.trim() ? { value: manufacturer, source: 'user' } : null,
          mpn: mpn.trim() ? { value: mpn, source: 'user' } : null,
        },
        {
          partPk: mode === 'enrich' ? partPk : undefined,
          supplierLinks,
          datasheetUrl: candidate.datasheet_url?.value ?? null,
          datasheetAction,
          imageUrl: useOfficialImage ? candidate.image_url?.value ?? null : null,
          parameters,
        },
      );

      // The InvenTree page we're embedded in (part detail / dashboard) has its
      // own cached copy of this data - force it to refetch so it doesn't keep
      // showing stale values after we've just changed them.
      context.queryClient?.invalidateQueries?.();

      notifications.show({
        title: mode === 'enrich' ? 'Part updated' : 'Part created',
        message: `${result.part_name} (#${result.part_pk})`,
        color: 'green',
      });

      for (const warning of result.warnings ?? []) {
        notifications.show({ title: 'Warning', message: warning, color: 'yellow', autoClose: false });
      }

      onCommitted(result);
    } catch (err: any) {
      const message = err?.response?.data?.error ?? 'Failed to save the part';
      notifications.show({ title: 'Error', message, color: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap="sm">
      {candidate.existing_matches.length > 0 && mode === 'create' && (
        <Alert color="yellow" title="Possible duplicate">
          <Stack gap={4}>
            <Text size="sm">Something similar already exists in InvenTree:</Text>
            {candidate.existing_matches.map((m) => (
              <UnstyledButton
                key={m.part_pk}
                onClick={() => context.navigate(`/part/${m.part_pk}/`)}
              >
                <Text size="sm" td="underline">
                  {m.part_name} {m.mpn ? `(${m.manufacturer} - ${m.mpn})` : ''} - #{m.part_pk}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </Alert>
      )}

      <Group gap={4}>
        <Text size="sm" fw={500}>
          Name
        </Text>
        <SourceBadge source={candidate.name?.source} />
      </Group>
      <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} />

      <Group gap={4}>
        <Text size="sm" fw={500}>
          Description
        </Text>
        <SourceBadge source={candidate.description?.source} />
      </Group>
      <Textarea value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />

      <Group grow>
        <Stack gap={4}>
          <Group gap={4}>
            <Text size="sm" fw={500}>
              Manufacturer
            </Text>
            <SourceBadge source={candidate.manufacturer?.source} />
          </Group>
          <TextInput value={manufacturer} onChange={(e) => setManufacturer(e.currentTarget.value)} />
        </Stack>
        <Stack gap={4}>
          <Group gap={4}>
            <Text size="sm" fw={500}>
              MPN
            </Text>
            <SourceBadge source={candidate.mpn?.source} />
          </Group>
          <TextInput value={mpn} onChange={(e) => setMpn(e.currentTarget.value)} />
        </Stack>
      </Group>

      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Category {candidate.category_guess ? '(AI suggestion, just a starting point for the search)' : ''}
        </Text>
        <Select
          placeholder="Type to search, or open the dropdown to browse..."
          searchable
          searchValue={categorySearch}
          onSearchChange={setCategorySearch}
          data={categoryOptions.map((c) => ({ value: String(c.pk), label: c.pathstring ?? c.name ?? '' }))}
          value={category ? String(category.pk) : null}
          onChange={(value) => {
            const found = categoryOptions.find((c) => String(c.pk) === value);
            setCategory(found ?? null);
          }}
          nothingFoundMessage={searching ? 'Searching...' : 'No matching category'}
          maxDropdownHeight={260}
          clearable
        />
      </Stack>

      {candidate.datasheet_url?.value && (
        <Stack gap={4}>
          <Group gap={4}>
            <Text size="sm" fw={500}>
              Datasheet
            </Text>
            <SourceBadge source={candidate.datasheet_url.source} />
          </Group>
          <Anchor href={candidate.datasheet_url.value} target="_blank" size="sm">
            {candidate.datasheet_url.value}
          </Anchor>
          <Radio.Group value={datasheetAction} onChange={(v) => setDatasheetAction(v as DatasheetAction)}>
            <Group>
              <Radio value="download_attach" label="Download and attach" />
              <Radio value="link_only" label="Keep link only" />
              <Radio value="skip" label="Skip" />
            </Group>
          </Radio.Group>
        </Stack>
      )}

      {candidate.image_url?.value && (
        <Stack gap={4}>
          <Group gap={4}>
            <Text size="sm" fw={500}>
              Product Image
            </Text>
            <SourceBadge source={candidate.image_url.source} />
          </Group>
          <Image src={candidate.image_url.value} alt="Product" w={120} h={120} fit="contain" radius="sm" />
          <Checkbox
            checked={useOfficialImage}
            onChange={(e) => setUseOfficialImage(e.currentTarget.checked)}
            label="Use as part image"
          />
        </Stack>
      )}

      {(candidate.supplier_links ?? []).length > 0 && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Suppliers
          </Text>
          {candidate.supplier_links.map((link) => (
            <Group key={link.supplier} gap="xs">
              <Checkbox
                checked={selectedSuppliers.has(link.supplier)}
                onChange={() => toggleSupplier(link.supplier)}
                label={`${link.supplier} - ${link.sku ?? '?'}`}
              />
              {link.url && (
                <Anchor href={link.url} target="_blank" size="xs">
                  view product
                </Anchor>
              )}
            </Group>
          ))}
        </Stack>
      )}

      {(candidate.parameters ?? []).length > 0 && (
        <Stack gap={4}>
          <Group justify="space-between">
            <Checkbox
              checked={allParametersSelected}
              indeterminate={someParametersSelected && !allParametersSelected}
              onChange={toggleAllParameters}
              label={`Parameters (${selectedParameters.size}/${allParameterNames.length})`}
            />
            <Anchor size="xs" onClick={toggleParametersOpened} component="button" type="button">
              {parametersOpened ? 'Hide' : 'Show'} details
            </Anchor>
          </Group>
          <Collapse expanded={parametersOpened}>
            <Stack gap={4} pl="lg">
              {candidate.parameters.map((p) => (
                <Group key={p.name} gap="xs">
                  <Checkbox
                    checked={selectedParameters.has(p.name)}
                    onChange={() => toggleParameter(p.name)}
                    label={`${p.name}: ${p.value}`}
                  />
                  <SourceBadge source={p.source} />
                </Group>
              ))}
            </Stack>
          </Collapse>
        </Stack>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!canCommit} loading={submitting} onClick={handleCommit}>
          {mode === 'enrich' ? 'Save changes' : 'Confirm and create part'}
        </Button>
      </Group>
    </Stack>
  );
}
