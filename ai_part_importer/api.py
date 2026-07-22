"""API views for the AIPartImporter plugin.

Every network call to the AI endpoint happens in the /identify/* views, which
only ever return a draft - nothing is written to the database until /commit,
which does no network calls at all.
"""

from rest_framework import permissions
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .ai_client import AIClientError
from .importer import CommitError, commit_draft
from .orchestrator import build_draft_from_photo, build_draft_from_text, build_enrichment_draft
from .serializers import (
    CommitRequestSerializer,
    EnrichRequestSerializer,
    IdentifyPhotoRequestSerializer,
    IdentifyTextRequestSerializer,
)

MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024


class PluginSettingsMixin:
    """Gives API views access to this plugin's own persisted settings."""

    def get_plugin_settings(self) -> dict:
        from plugin.registry import registry

        plugin = registry.get_plugin('ai-part-importer')
        return plugin.get_settings_dict()


class IdentifyTextView(PluginSettingsMixin, APIView):
    """POST {"text": "..."} -> a draft with one or more candidates."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = IdentifyTextRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            draft = build_draft_from_text(
                settings=self.get_plugin_settings(),
                text=serializer.validated_data['text'],
            )
        except AIClientError as exc:
            return Response({'error': str(exc)}, status=502)

        return Response(draft, status=200)


class IdentifyPhotoView(PluginSettingsMixin, APIView):
    """POST a multipart image (+ optional "text" context) -> a draft."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        serializer = IdentifyPhotoRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        image = serializer.validated_data['image']

        if image.size > MAX_IMAGE_UPLOAD_BYTES:
            return Response(
                {'error': f'Image is too large (max {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)}MB)'},
                status=400,
            )

        try:
            draft = build_draft_from_photo(
                settings=self.get_plugin_settings(),
                image_bytes=image.read(),
                text=serializer.validated_data['text'],
            )
        except AIClientError as exc:
            return Response({'error': str(exc)}, status=502)

        return Response(draft, status=200)


class CommitView(APIView):
    """POST the user-confirmed draft -> create the Part (+ ManufacturerPart)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = CommitRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            part, warnings = commit_draft(
                resolved=serializer.validated_data['resolved'],
                category_pk=serializer.validated_data['category_pk'],
                user=request.user,
                part_pk=serializer.validated_data['part_pk'],
                supplier_links=serializer.validated_data['supplier_links'],
                datasheet_url=serializer.validated_data['datasheet_url'],
                datasheet_action=serializer.validated_data['datasheet_action'],
                image_url=serializer.validated_data['image_url'],
            )
        except CommitError as exc:
            return Response({'error': str(exc)}, status=400)

        return Response(
            {'part_pk': part.pk, 'part_name': part.name, 'warnings': warnings},
            status=201,
        )


class EnrichView(PluginSettingsMixin, APIView):
    """POST optional {"text": "..."} -> a draft focused on filling gaps on an
    existing Part (never overwrites fields that are already set)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, part_pk, *args, **kwargs):
        from part.models import Part

        serializer = EnrichRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            part = Part.objects.get(pk=part_pk)
        except Part.DoesNotExist:
            return Response({'error': f'Part {part_pk} does not exist'}, status=404)

        try:
            draft = build_enrichment_draft(
                settings=self.get_plugin_settings(),
                part=part,
                text=serializer.validated_data['text'],
            )
        except AIClientError as exc:
            return Response({'error': str(exc)}, status=502)

        return Response(draft, status=200)


class TestConnectionView(PluginSettingsMixin, APIView):
    """GET -> quick check that AI_BASE_URL/AI_API_KEY actually work."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        from .ai_client import identify_from_text

        settings = self.get_plugin_settings()

        try:
            identify_from_text(
                base_url=settings.get('AI_BASE_URL'),
                api_key=settings.get('AI_API_KEY'),
                model=settings.get('AI_TEXT_MODEL'),
                text='2N2222',
            )
        except AIClientError as exc:
            return Response({'ok': False, 'error': str(exc)}, status=200)

        return Response({'ok': True}, status=200)


class DuplicatesView(APIView):
    """GET ?mpn=&manufacturer=&name= -> existing ManufacturerPart/Part matches."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        from .duplicates import search_existing

        matches = search_existing(
            mpn=request.query_params.get('mpn', ''),
            manufacturer=request.query_params.get('manufacturer', ''),
            name=request.query_params.get('name', ''),
        )

        return Response({'matches': matches}, status=200)
