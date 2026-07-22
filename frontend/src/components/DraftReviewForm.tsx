import { useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { InvenTreePluginContext } from '@inventreedb/ui';

import {
  type CategoryMatch,
  type CommitResult,
  type DatasheetAction,
  type DraftCandidate,
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
  const [categoryResults, setCategoryResults] = useState<CategoryMatch[]>([]);
  const [category, setCategory] = useState<CategoryMatch | null>(initialCategory);
  const [searching, setSearching] = useState(false);

  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<string>>(
    new Set((candidate.supplier_links ?? []).map((l) => l.supplier)),
  );
  const [datasheetAction, setDatasheetAction] = useState<DatasheetAction>(
    candidate.datasheet_url ? 'link_only' : 'skip',
  );

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

  const runCategorySearch = async () => {
    setSearching(true);
    try {
      const results = await searchCategories(context, categorySearch);
      setCategoryResults(results);
    } catch {
      notifications.show({ title: 'Erro', message: 'Falha ao buscar categorias', color: 'red' });
    } finally {
      setSearching(false);
    }
  };

  const handleCommit = async () => {
    if (!category) {
      return;
    }

    setSubmitting(true);
    try {
      const supplierLinks: SupplierLink[] = (candidate.supplier_links ?? []).filter((l) =>
        selectedSuppliers.has(l.supplier),
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
        },
      );

      notifications.show({
        title: mode === 'enrich' ? 'Peça atualizada' : 'Peça criada',
        message: `${result.part_name} (#${result.part_pk})`,
        color: 'green',
      });

      onCommitted(result);
    } catch (err: any) {
      const message = err?.response?.data?.error ?? 'Falha ao salvar a peça';
      notifications.show({ title: 'Erro', message, color: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap="sm">
      {candidate.existing_matches.length > 0 && mode === 'create' && (
        <Alert color="yellow" title="Possível duplicata">
          <Stack gap={4}>
            <Text size="sm">Já existe algo parecido no InvenTree:</Text>
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
          Nome
        </Text>
        <SourceBadge source={candidate.name?.source} />
      </Group>
      <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} />

      <Group gap={4}>
        <Text size="sm" fw={500}>
          Descrição
        </Text>
        <SourceBadge source={candidate.description?.source} />
      </Group>
      <Textarea value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />

      <Group grow>
        <Stack gap={4}>
          <Group gap={4}>
            <Text size="sm" fw={500}>
              Fabricante
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
          Categoria {candidate.category_guess ? '(sugestão da IA, só um ponto de partida para a busca)' : ''}
        </Text>
        <Group>
          <TextInput
            flex={1}
            value={categorySearch}
            onChange={(e) => setCategorySearch(e.currentTarget.value)}
            placeholder="Buscar categoria..."
          />
          <Button variant="light" loading={searching} onClick={runCategorySearch}>
            Buscar
          </Button>
        </Group>
        {category && (
          <Alert color="green" py={4}>
            Selecionada: {category.pathstring ?? category.name}
          </Alert>
        )}
        {categoryResults.length > 0 && (
          <Stack gap={2}>
            {categoryResults.map((c) => (
              <UnstyledButton key={c.pk} onClick={() => setCategory(c)}>
                <Text size="sm">{c.pathstring ?? c.name}</Text>
              </UnstyledButton>
            ))}
          </Stack>
        )}
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
              <Radio value="download_attach" label="Baixar e anexar" />
              <Radio value="link_only" label="Só guardar o link" />
              <Radio value="skip" label="Ignorar" />
            </Group>
          </Radio.Group>
        </Stack>
      )}

      {(candidate.supplier_links ?? []).length > 0 && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Fornecedores
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
                  ver produto
                </Anchor>
              )}
            </Group>
          ))}
        </Stack>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
        <Button disabled={!canCommit} loading={submitting} onClick={handleCommit}>
          {mode === 'enrich' ? 'Salvar alterações' : 'Confirmar e criar peça'}
        </Button>
      </Group>
    </Stack>
  );
}
