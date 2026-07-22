"""Look for InvenTree parts that might already match an AI-identified candidate,
so we never silently create a second Part for something that already exists.
"""


def search_existing(*, mpn: str = '', manufacturer: str = '', name: str = '') -> list:
    """Search existing ManufacturerPart / Part records for a plausible match.

    Returns a list of {"part_pk", "part_name", "manufacturer_part_pk", "mpn"} dicts.
    Matching is intentionally loose (icontains) - this is a heads-up for the user,
    not an exact-match gate.
    """

    from company.models import ManufacturerPart

    matches = []

    if mpn:
        qs = ManufacturerPart.objects.filter(MPN__icontains=mpn).select_related('part', 'manufacturer')

        if manufacturer:
            qs = qs.filter(manufacturer__name__icontains=manufacturer)

        for mp in qs[:10]:
            matches.append({
                'part_pk': mp.part.pk,
                'part_name': mp.part.name,
                'manufacturer_part_pk': mp.pk,
                'manufacturer': mp.manufacturer.name if mp.manufacturer else None,
                'mpn': mp.MPN,
            })

    if not matches and name:
        from part.models import Part

        for part in Part.objects.filter(name__icontains=name)[:10]:
            matches.append({
                'part_pk': part.pk,
                'part_name': part.name,
                'manufacturer_part_pk': None,
                'manufacturer': None,
                'mpn': None,
            })

    return matches
