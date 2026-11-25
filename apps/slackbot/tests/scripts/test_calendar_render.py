import http.server
import logging
import os
import sys
import threading
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import calendar_render


@pytest.fixture
def fake_playwright(monkeypatch):
    browser = MagicMock()
    context = browser.new_context.return_value
    page = context.new_page.return_value
    page.locator.return_value.bounding_box.return_value = {"width": 10.2, "height": 5.0}
    page.locator.return_value.screenshot.return_value = b"png-bytes"
    playwright = MagicMock()
    playwright.chromium.launch.return_value = browser
    manager = MagicMock()
    manager.__enter__.return_value = playwright
    # Unit tests must not launch a browser, so the module is faked outright.
    monkeypatch.setitem(sys.modules, "playwright", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "playwright.sync_api", SimpleNamespace(sync_playwright=lambda: manager))
    return playwright, browser, context, page


def test_screenshot_page_has_no_network_or_script(fake_playwright):
    playwright, browser, context, page = fake_playwright

    assert calendar_render.screenshot_html_offline("<div></div>") == b"png-bytes"

    playwright.chromium.launch.assert_called_once_with()
    browser.new_context.assert_called_once_with(java_script_enabled=False, offline=True, service_workers="block")
    context.route.assert_called_once_with("**/*", calendar_render._block_request)
    call_order = [name for name, _, _ in context.method_calls]
    assert call_order.index("route") < call_order.index("new_page")
    page.set_viewport_size.assert_called_once_with({"width": 31, "height": 25})
    browser.close.assert_called_once_with()


def test_blocked_request_is_aborted_and_logged_without_url(caplog):
    route = MagicMock()
    route.request.url = "http://169.254.169.254/x"
    route.request.resource_type = "image"

    with caplog.at_level(logging.WARNING, logger=calendar_render.__name__):
        calendar_render._block_request(route)

    route.abort.assert_called_once_with()
    route.continue_.assert_not_called()
    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "resource_type=image" in caplog.text
    assert "scheme=http" in caplog.text
    assert "169.254" not in caplog.text


def test_export_table_png_writes_cropped_png_from_offline_screenshot(tmp_path, monkeypatch):
    pages = []

    def fake_screenshot(page_html):
        pages.append(page_html)
        image = Image.new("RGB", (40, 30), "white")
        image.paste((0, 0, 0), (5, 5, 25, 20))
        buf = BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    monkeypatch.setattr(calendar_render, "screenshot_html_offline", fake_screenshot)
    path = tmp_path / "table.png"
    calendar_render.export_table_png(pd.DataFrame({"AO": ["x"]}).style, str(path))

    assert len(pages) == 1
    assert '<div id="dfi_table">' in pages[0]
    with Image.open(path) as image:
        assert image.format == "PNG"
        assert image.size == (20, 15)


def test_failed_render_restores_pillow_pixel_limit(tmp_path, monkeypatch):
    before = Image.MAX_IMAGE_PIXELS

    def failing_screenshot(page_html):
        raise RuntimeError("render failed")

    monkeypatch.setattr(calendar_render, "screenshot_html_offline", failing_screenshot)
    with pytest.raises(RuntimeError, match="render failed"):
        calendar_render.export_table_png(pd.DataFrame({"AO": ["x"]}).style, str(tmp_path / "table.png"))

    assert before is not None
    assert Image.MAX_IMAGE_PIXELS == before


def test_browser_closes_when_table_is_missing(fake_playwright):
    _, browser, _, page = fake_playwright
    page.locator.return_value.bounding_box.return_value = None

    with pytest.raises(RuntimeError, match="no bounding box"):
        calendar_render.screenshot_html_offline("<div></div>")
    browser.close.assert_called_once_with()


class _CountingHandler(http.server.BaseHTTPRequestHandler):
    hits: list[str] = []

    def do_GET(self):
        self.hits.append(self.path)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


def _chromium_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            p.chromium.launch().close()
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _chromium_available(), reason="Playwright Chromium is not installed")
def test_real_chromium_render_makes_no_requests(tmp_path):
    _CountingHandler.hits = []
    server = http.server.HTTPServer(("127.0.0.1", 0), _CountingHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        unescaped = (
            f'<img src="{base}/img"><link rel="stylesheet" href="{base}/css">'
            f'<iframe src="{base}/frame"></iframe><script>fetch("{base}/script")</script>'
        )
        styler = pd.DataFrame({"AO": [unescaped]}).style.set_table_styles(
            [{"selector": "td", "props": [("background-image", f"url({base}/bg)")]}]
        )
        path = tmp_path / "table.png"

        calendar_render.export_table_png(styler, str(path))

        assert _CountingHandler.hits == []
        with Image.open(path) as image:
            assert image.format == "PNG"
            assert image.width > 0 and image.height > 0
    finally:
        server.shutdown()
        server.server_close()
