"""Turns a user-confirmed draft into real InvenTree records.

Only called from the /commit endpoint, after the user has reviewed and edited
everything in the frontend - this module does no AI/network calls except the
one-shot datasheet/image download (when requested), inside a single
transaction.
"""

import logging
import re
from urllib.parse import unquote, urlparse

from django.db import transaction

logger = logging.getLogger('inventree_plugins.ai_part_importer')

SUPPLIER_DISPLAY_NAMES = {
    'digikey': 'DigiKey',
    'mouser': 'Mouser',
}


def _safe_filename_from_url(url: str, default_name: str) -> str:
    """Turn a (possibly URL-encoded, query-stringed) download URL into a
    filename that's safe to hand to Django's file storage - it doesn't
    URL-decode or sanitize on its own, so a literal `%7E` or similar ends up
    baked into the stored filename otherwise."""

    path = urlparse(url).path
    name = unquote(path.rsplit('/', 1)[-1])
    name = re.sub(r'[^A-Za-z0-9._-]', '_', name)

    if not name or '.' not in name:
        name = default_name

    return name


class CommitError(Exception):
    """Raised when the resolved draft can't be committed as given."""


@transaction.atomic
def commit_draft(
    *,
    resolved: dict,
    category_pk: int,
    user,
    part_pk: int = None,
    supplier_links: list = None,
    datasheet_url: str = None,
    datasheet_action: str = 'skip',
    image_url: str = None,
):
    """Create a Part (+ ManufacturerPart, + SupplierParts, + datasheet), or,
    when `part_pk` is given, apply the same resolved fields to that existing
    Part instead (the "enrich" flow) rather than creating a new one.

    `resolved` is the single resolved candidate shape from the draft schema:
    {"name": {"value": ...}, "description": {...}, "manufacturer": {...}, "mpn": {...}, ...}
    Only the plain `value` of each tagged field is used here - source/verified
    tags are UI/audit concerns already acted on by the time we get here (the
    frontend review screen is what a user actually confirmed).

    Returns (part, warnings) - `warnings` is a list of human-readable strings
    for anything that didn't fully succeed (e.g. an image/datasheet that
    couldn't be downloaded) without blocking the rest of the commit.
    """

    from part.models import Part, PartCategory

    warnings: list = []

    def value_of(field_name):
        field = resolved.get(field_name)
        return field.get('value') if field else None

    name = value_of('name')
    if not name:
        raise CommitError('Part name is required')

    try:
        category = PartCategory.objects.get(pk=category_pk)
    except PartCategory.DoesNotExist as exc:
        raise CommitError(f'Category {category_pk} does not exist') from exc

    if part_pk:
        try:
            part = Part.objects.get(pk=part_pk)
        except Part.DoesNotExist as exc:
            raise CommitError(f'Part {part_pk} does not exist') from exc

        part.name = name
        part.description = value_of('description') or part.description
        part.category = category
        part.save()
    else:
        part = Part.objects.create(
            name=name,
            description=value_of('description') or '',
            category=category,
            component=True,
            purchaseable=True,
        )

    # TODO: remove this DEBUG block once image handling is confirmed working
    # end-to-end - server-side logging has been unreliable to inspect here,
    # so route the outcome through the same warnings list the UI already shows.
    if image_url:
        error = _apply_part_image(part, image_url)
        if error:
            warnings.append(f'Could not set part image: {error}')
        else:
            warnings.append(f'DEBUG: part image was set successfully from {image_url}')
    else:
        warnings.append('DEBUG: no image_url was received by /commit')

    if datasheet_url and datasheet_action != 'skip':
        # Also set the Part's own link, not just the ManufacturerPart's -
        # otherwise the datasheet is only visible by drilling into Suppliers,
        # instead of right on the Part detail page.
        part.link = datasheet_url
        part.save()

    manufacturer_name = value_of('manufacturer')
    mpn = value_of('mpn')

    manufacturer_part = None
    if manufacturer_name and mpn:
        manufacturer_part = _get_or_create_manufacturer_part(part, manufacturer_name, mpn)

        if datasheet_url and datasheet_action != 'skip':
            error = _apply_datasheet(manufacturer_part, datasheet_url, datasheet_action)
            if error:
                warnings.append(f'Could not attach datasheet: {error}')

    for link in supplier_links or []:
        _create_supplier_part(part, manufacturer_part, link)

    _record_audit_trail(part, resolved=resolved, user=user)

    return part, warnings


def _record_audit_trail(part, *, resolved: dict, user):
    """Best-effort: stash which fields came from the AI vs. official APIs vs.
    the user, so it's later possible to see why a field has the value it has.
    Never allowed to fail the commit - metadata support/shape can vary across
    InvenTree versions."""

    try:
        part.set_metadata(
            'ai_part_importer',
            {
                'resolved': resolved,
                'committed_by': getattr(user, 'username', None),
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('Could not record AI Part Importer audit metadata: %s', exc)


def _apply_part_image(part, image_url: str):
    """Download the supplier's official product photo and set it as the
    Part's own image. Never allowed to fail the commit - returns an error
    string (instead of raising) so the caller can surface it as a warning."""

    try:
        import requests
        from django.core.files.base import ContentFile

        response = requests.get(image_url, timeout=30)
        response.raise_for_status()

        filename = _safe_filename_from_url(image_url, 'image.jpg')
        part.image.save(filename, ContentFile(response.content), save=True)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning('Could not download/set part image from %s: %s', image_url, exc)
        return str(exc)


def _get_or_create_manufacturer_part(part, manufacturer_name: str, mpn: str):
    from company.models import Company, ManufacturerPart

    manufacturer, _created = Company.objects.get_or_create(
        name=manufacturer_name,
        defaults={'is_manufacturer': True},
    )

    if not manufacturer.is_manufacturer:
        manufacturer.is_manufacturer = True
        manufacturer.save()

    manufacturer_part, _created = ManufacturerPart.objects.get_or_create(
        part=part,
        manufacturer=manufacturer,
        MPN=mpn,
    )
    return manufacturer_part


def _apply_datasheet(manufacturer_part, datasheet_url: str, datasheet_action: str):
    """Either just store the link, or download the PDF and attach it. Returns
    an error string on failure (falling back to just storing the link),
    or None on success."""

    if datasheet_action == 'link_only':
        manufacturer_part.link = datasheet_url
        manufacturer_part.save()
        return None

    if datasheet_action == 'download_attach':
        try:
            _download_and_attach_datasheet(manufacturer_part, datasheet_url)
            return None
        except Exception as exc:  # noqa: BLE001 - never let a download failure block the commit
            logger.warning('Datasheet download/attach failed for %s: %s', datasheet_url, exc)
            manufacturer_part.link = datasheet_url
            manufacturer_part.save()
            return str(exc)

    return None


def _download_and_attach_datasheet(manufacturer_part, datasheet_url: str):
    import requests
    from django.core.files.base import ContentFile

    response = requests.get(datasheet_url, timeout=30)
    response.raise_for_status()

    filename = _safe_filename_from_url(datasheet_url, 'datasheet.pdf')
    if not filename.lower().endswith('.pdf'):
        filename += '.pdf'

    # InvenTree 1.x consolidated per-model attachment tables into a single
    # generic Attachment model - see common.models.Attachment. If this import
    # fails against a different InvenTree version, the caller's except clause
    # above falls back to just storing the link.
    from common.models import Attachment

    Attachment.objects.create(
        model_type='manufacturerpart',
        model_id=manufacturer_part.pk,
        attachment=ContentFile(response.content, name=filename),
        comment='Datasheet (AI Part Importer)',
    )


def _create_supplier_part(part, manufacturer_part, link: dict):
    from company.models import Company, SupplierPart

    supplier_key = link.get('supplier')
    supplier_name = SUPPLIER_DISPLAY_NAMES.get(supplier_key, supplier_key)

    if not supplier_name:
        return

    supplier, _created = Company.objects.get_or_create(
        name=supplier_name,
        defaults={'is_supplier': True},
    )

    if not supplier.is_supplier:
        supplier.is_supplier = True
        supplier.save()

    supplier_part, _created = SupplierPart.objects.get_or_create(
        part=part,
        supplier=supplier,
        SKU=link.get('sku') or '',
        defaults={
            'link': link.get('url') or '',
            'manufacturer_part': manufacturer_part,
        },
    )

    _create_price_breaks(supplier_part, link.get('price_breaks') or [])


def _create_price_breaks(supplier_part, price_breaks: list):
    try:
        from company.models import SupplierPriceBreak
    except ImportError:
        logger.warning('SupplierPriceBreak model not available, skipping price breaks')
        return

    for pb in price_breaks:
        quantity = pb.get('quantity')
        price = pb.get('price')

        if quantity is None or price is None:
            continue

        try:
            SupplierPriceBreak.objects.create(
                part=supplier_part,
                quantity=quantity,
                price=price,
            )
        except Exception as exc:  # noqa: BLE001 - a bad price-break row shouldn't break the commit
            logger.warning('Could not create price break %s: %s', pb, exc)
