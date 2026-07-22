"""Identify electronic components from a photo or text via an OpenAI-compatible AI endpoint, optionally enrich with official DigiKey/Mouser data, and import them into InvenTree after manual review."""


from plugin import InvenTreePlugin

from plugin.mixins import SettingsMixin, UrlsMixin, UserInterfaceMixin

from . import PLUGIN_VERSION


class AIPartImporter(SettingsMixin, UrlsMixin, UserInterfaceMixin, InvenTreePlugin):

    """AIPartImporter - custom InvenTree plugin."""

    # Plugin metadata
    TITLE = "AI Part Importer"
    NAME = "AIPartImporter"
    SLUG = "ai-part-importer"
    DESCRIPTION = "Identify electronic components from a photo or text via an OpenAI-compatible AI endpoint, optionally enrich with official DigiKey/Mouser data, and import them into InvenTree after manual review."
    VERSION = PLUGIN_VERSION

    # Additional project information
    AUTHOR = "Your Name"
    WEBSITE = "https://github.com/yourname/inventree-ai-part-importer"
    LICENSE = "MIT"

    # Optionally specify supported InvenTree versions
    # MIN_VERSION = '0.18.0'
    # MAX_VERSION = '2.0.0'

    # Plugin settings (from SettingsMixin)
    # Ref: https://docs.inventree.org/en/latest/plugins/mixins/settings/
    SETTINGS = {
        'AI_BASE_URL': {
            'name': 'AI Base URL',
            'description': (
                'Base URL of an OpenAI-compatible /chat/completions endpoint '
                '(e.g. your LiteLLM proxy, or any other compatible server).'
            ),
            'default': '',
        },
        'AI_API_KEY': {
            'name': 'AI API Key',
            'description': 'API key for the configured AI endpoint, if it requires one.',
            'default': '',
            'protected': True,
        },
        'AI_TEXT_MODEL': {
            'name': 'AI Text Model',
            'description': 'Model name to request for text-only identification.',
            'default': '',
        },
        'AI_VISION_MODEL': {
            'name': 'AI Vision Model',
            'description': 'Model name to request for photo-based identification (must support image input).',
            'default': '',
        },
        'MIN_CONFIDENCE': {
            'name': 'Minimum candidate confidence',
            'description': 'AI candidates below this confidence (0-1) are discarded.',
            'validator': float,
            'default': 0.3,
        },
        'DIGIKEY_CLIENT_ID': {
            'name': 'DigiKey Client ID',
            'description': 'Optional - OAuth2 client ID for the DigiKey Product Information API.',
            'default': '',
            'protected': True,
            'required': False,
        },
        'DIGIKEY_CLIENT_SECRET': {
            'name': 'DigiKey Client Secret',
            'description': 'Optional - OAuth2 client secret for the DigiKey Product Information API.',
            'default': '',
            'protected': True,
            'required': False,
        },
        'MOUSER_API_KEY': {
            'name': 'Mouser API Key',
            'description': 'Optional - API key for the Mouser Search API.',
            'default': '',
            'protected': True,
            'required': False,
        },
        'PREFER_OFFICIAL_DATA': {
            'name': 'Prefer official supplier data',
            'description': (
                'When DigiKey/Mouser credentials are configured, let their data '
                'override the AI-guessed description/manufacturer/datasheet.'
            ),
            'validator': bool,
            'default': True,
        },
    }

    # Custom URL endpoints (from UrlsMixin)
    # Ref: https://docs.inventree.org/en/latest/plugins/mixins/urls/
    def setup_urls(self):
        """Configure custom URL endpoints for this plugin."""
        from django.urls import path

        from .api import (
            CommitView,
            DuplicatesView,
            EnrichView,
            IdentifyPhotoView,
            IdentifyTextView,
            TestConnectionView,
        )

        return [
            path('identify/text/', IdentifyTextView.as_view(), name='identify-text'),
            path('identify/photo/', IdentifyPhotoView.as_view(), name='identify-photo'),
            path('enrich/<int:part_pk>/', EnrichView.as_view(), name='enrich'),
            path('commit/', CommitView.as_view(), name='commit'),
            path('duplicates/', DuplicatesView.as_view(), name='duplicates'),
            path('test-connection/', TestConnectionView.as_view(), name='test-connection'),
        ]

    # User interface elements (from UserInterfaceMixin)
    # Ref: https://docs.inventree.org/en/latest/plugins/mixins/ui/

    # Custom primary action - a button in the page header (e.g. on the Part
    # list, or Stock views) that opens the identify/review/create flow in a
    # modal. Replaces the earlier dashboard-widget approach, which was stuck
    # in a small fixed-size grid cell and wasn't a great fit for this flow.
    def get_ui_primary_actions(self, request, context: dict, **kwargs):
        """Return a list of custom primary actions to be rendered in the InvenTree user interface."""

        return [{
            'key': 'ai-part-importer-action',
            'title': 'Import via AI',
            'description': 'Identify a component from text/photo and import it into InvenTree.',
            'icon': 'ti:sparkles:outline',
            'source': self.plugin_static_file('PrimaryAction.js:RenderAIPartImporterAction'),
        }]

    # Custom UI panels
    def get_ui_panels(self, request, context: dict, **kwargs):
        """Return a list of custom panels to be rendered in the InvenTree user interface."""

        if context.get('target_model') != 'part':
            return []

        return [{
            'key': 'ai-part-importer-enrich',
            'title': 'AI Enrich',
            'description': 'Fill in missing data on this part using AI (and DigiKey/Mouser, if configured).',
            'icon': 'ti:sparkles:outline',
            'source': self.plugin_static_file('Panel.js:RenderAIPartImporterPanel'),
        }]

