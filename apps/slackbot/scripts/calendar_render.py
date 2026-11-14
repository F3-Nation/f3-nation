"""Render a pandas Styler table to PNG in a headless Chromium page that cannot reach the network.

Calendar tables carry text from user-edited records. Escaping it is the
caller's job (``Styler.format(escape="html")``); this renderer is the second layer,
so markup that slips through still cannot fetch URLs or run script. dataframe_image's
own Playwright converter launches Chromium with ``--disable-web-security`` and a
network-enabled page, so it is not used.
"""

import logging
import math
from io import BytesIO

logger = logging.getLogger(__name__)


def _block_request(route) -> None:
    # A clean render makes no requests, so any request here means markup escaped the caller's escaping.
    # The URL is attacker-chosen and may contain member names, so only its type and scheme are logged.
    logger.warning(
        "Blocked request during calendar render (resource_type=%s, scheme=%s)",
        route.request.resource_type,
        route.request.url.split(":", 1)[0],
    )
    route.abort()


def screenshot_html_offline(page_html: str) -> bytes:
    """Return a PNG screenshot of the ``#dfi_table table`` element in ``page_html``."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(java_script_enabled=False, offline=True, service_workers="block")
            context.route("**/*", _block_request)
            page = context.new_page()
            page.set_content(page_html)
            locator = page.locator("#dfi_table table")
            bbox = locator.bounding_box()
            if bbox is None:
                raise RuntimeError("Rendered calendar table has no bounding box")
            page.set_viewport_size({"width": math.ceil(bbox["width"]) + 20, "height": math.ceil(bbox["height"]) + 20})
            return locator.screenshot()
        finally:
            browser.close()


def export_table_png(styler, path: str) -> None:
    """Write ``styler`` as a PNG to ``path``, laid out as ``dataframe_image.export`` does."""
    from dataframe_image._pandas_accessor import disable_max_image_pixels, generate_html
    from dataframe_image.converter.browser.base import BrowserConverter
    from PIL import Image

    # Only the page template, crop and PNG encoding are used; its screenshot is replaced above.
    layout = BrowserConverter(fontsize=14, encode_base64=False)
    page_html = layout.build_valid_html(generate_html(styler, path))
    screenshot = screenshot_html_offline(page_html)
    with disable_max_image_pixels():
        image = layout.crop(Image.open(BytesIO(screenshot)))
        png = layout.finalize_image(image)
    with open(path, "wb") as f:
        f.write(png)
