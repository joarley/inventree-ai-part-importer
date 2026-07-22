"""Request payload validation for the AIPartImporter plugin's API endpoints.

Response payloads (drafts) are plain dicts - see orchestrator.py for their
shape - since they're internal to this plugin's own frontend, not part of the
general InvenTree API schema.
"""

from rest_framework import serializers


class IdentifyTextRequestSerializer(serializers.Serializer):
    """Body of POST /plugin/ai-part-importer/identify/text/"""

    text = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=2000,
        help_text='Free text description or partial part number to identify.',
    )


class IdentifyPhotoRequestSerializer(serializers.Serializer):
    """Body of POST /plugin/ai-part-importer/identify/photo/ (multipart)."""

    image = serializers.ImageField(required=True)
    text = serializers.CharField(required=False, allow_blank=True, default='')


class CommitRequestSerializer(serializers.Serializer):
    """Body of POST /plugin/ai-part-importer/commit/"""

    category_pk = serializers.IntegerField(required=True)
    resolved = serializers.DictField(required=True)
    part_pk = serializers.IntegerField(required=False, allow_null=True, default=None)
    supplier_links = serializers.ListField(
        child=serializers.DictField(), required=False, default=list
    )
    datasheet_url = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    datasheet_action = serializers.ChoiceField(
        choices=['link_only', 'download_attach', 'skip'], required=False, default='skip'
    )
    image_url = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    parameters = serializers.ListField(
        child=serializers.DictField(), required=False, default=list
    )


class EnrichRequestSerializer(serializers.Serializer):
    """Body of POST /plugin/ai-part-importer/enrich/<part_pk>/"""

    text = serializers.CharField(required=False, allow_blank=True, default='')
