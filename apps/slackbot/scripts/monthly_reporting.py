import os
import ssl
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List

import pytz
from f3_data_models.models import (
    AttendanceExpanded,
    EventInstanceExpanded,
    Org,
    Org_x_SlackSpace,
    SlackSpace,
)
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import and_, func, literal, select, union_all

from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get


@dataclass
class OrgMonthlySummary:
    org_id: int
    month: datetime
    event_count: int
    total_posts: int
    total_fngs: int
    unique_pax_count: int


@dataclass
class OrgUserLeaderboard:
    basis: str  # "month" or "ytd"
    org_id: int
    org_name: str
    user_id: int
    f3_name: str
    avatar_url: str
    post_count: int
    total_qs: int


# Create the horizontal bar chart (dark + neon styling)
# neon_colors = ["#00F5D4", "#7B2FF7", "#F72585"]  # aqua, purple, magenta
NEON_GREEN = "#39FF14"
# Default export size (pixels) and scale multiplier for higher DPI
DEFAULT_IMAGE_WIDTH = 800
DEFAULT_IMAGE_HEIGHT = 800
DEFAULT_IMAGE_SCALE = 3


def upload_files_to_slack(file_paths: List[str], settings: SlackSettings, text: str, channel: str):
    if not settings.bot_token or not file_paths or not channel:
        print("Slack bot token or reporting channel not configured; skipping upload")
        return

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    client = WebClient(token=settings.bot_token, ssl=ssl_context)

    file_list = []
    for fp in file_paths:
        with open(fp, "rb") as f:
            file_bytes = f.read()
        file = {
            "filename": fp,
            "file": file_bytes,
        }
        file_list.append(file)
    try:
        _ = client.files_upload_v2(
            channel=channel,
            file_uploads=file_list,
            initial_comment=text or "F3 Nation Reports",
        )
    except SlackApiError as e:
        if e.response["error"] == "not_in_channel":
            try:
                client.conversations_join(channel=channel)
                _ = client.files_upload_v2(
                    channel=channel,
                    file_uploads=file_list,
                    initial_comment=text or "F3 Nation Reports",
                )
            except SlackApiError as e2:
                print(f"Error joining channel or uploading file to Slack: {e2.response['error']}")
        else:
            print(f"Error uploading file to Slack: {e.response['error']}")


def run_reporting_single_org(body: dict, client: WebClient, logger: any, context: dict, region_record: SlackSettings):
    org_leaderboard_dict = pull_org_leaderboard_data()
    monthly_summary_dict = pull_org_summary_data()
    upload_files = []
    if region_record.org_id:
        if region_record.reporting_region_leaderboard_enabled and region_record.reporting_region_channel:
            if region_record.org_id in org_leaderboard_dict:
                upload_files.append(create_post_leaders_plot(org_leaderboard_dict[region_record.org_id]))
        if region_record.reporting_region_monthly_summary_enabled:
            if region_record.org_id in monthly_summary_dict:
                upload_files.append(create_org_monthly_summary(monthly_summary_dict[region_record.org_id]))
        # Upload all files for the region
        upload_files_to_slack(
            upload_files,
            region_record,
            text="Here are your region's monthly reports!",
            channel=region_record.reporting_region_channel,
        )
    if region_record.reporting_ao_leaderboard_enabled or region_record.reporting_ao_monthly_summary_enabled:
        # AO reports
        ao_orgs = DbManager.find_records(Org, filters=[Org.parent_id == region_record.org_id, Org.is_active])
        for ao in ao_orgs:
            upload_files = []
            channel = safe_get(ao.meta, "slack_channel_id") or region_record.backblast_destination_channel
            if ao.id in org_leaderboard_dict and region_record.reporting_ao_leaderboard_enabled:
                upload_files.append(create_post_leaders_plot(org_leaderboard_dict[ao.id]))
            if ao.id in monthly_summary_dict and region_record.reporting_ao_monthly_summary_enabled:
                upload_files.append(create_org_monthly_summary(monthly_summary_dict[ao.id]))
            upload_files_to_slack(
                upload_files,
                region_record,
                text=f"Here are your ({ao.name}) monthly reports!",
                channel=channel,
            )


def cycle_all_orgs(run_org_id: int = None):
    current_time = datetime.now(pytz.timezone("US/Central"))
    if run_org_id or (current_time.day == 2 and current_time.hour == 20):
        records = DbManager.find_join_records3(Org_x_SlackSpace, Org, SlackSpace, filters=[Org.is_active])
        region_orgs: List[Org] = [r[1] for r in records]
        slack_spaces: List[SlackSpace] = [r[2] for r in records]
        # org_leaderboard_dict = pull_org_leaderboard_data()
        monthly_summary_dict = pull_org_summary_data()

        if run_org_id is None:
            # Region reports
            for org, slack in zip(region_orgs, slack_spaces, strict=False):
                try:
                    settings = SlackSettings(**slack.settings)
                    upload_files = []
                    # if org.id in org_leaderboard_dict:
                    #     if settings.reporting_region_leaderboard_enabled and settings.reporting_region_channel:
                    #         upload_files.append(create_post_leaders_plot(org_leaderboard_dict[org.id]))
                    if org.id in monthly_summary_dict:
                        if settings.reporting_region_monthly_summary_enabled:
                            upload_files.append(create_org_monthly_summary(monthly_summary_dict[org.id]))
                    # Upload all files for the region
                    upload_files_to_slack(
                        upload_files,
                        settings,
                        text=f"Here are your region's monthly summaries! Looking for leaderboards? Find these and more at {os.getenv('STATS_URL')}/stats/region/{org.id}",  # noqa: E501
                        channel=settings.reporting_region_channel,
                    )

                    if settings.reporting_ao_monthly_summary_enabled:
                        # AO reports
                        ao_orgs = DbManager.find_records(Org, filters=[Org.parent_id == org.id, Org.is_active])
                        for ao in ao_orgs:
                            upload_files = []
                            channel = ao.meta.get("slack_channel_id") or settings.backblast_destination_channel
                            # if ao.id in org_leaderboard_dict and settings.reporting_ao_leaderboard_enabled:
                            # #     channel = ao.meta.get("slack_channel_id") or settings.backblast_destination_channel
                            # #     upload_files.append(create_post_leaders_plot(org_leaderboard_dict[ao.id]))
                            if ao.id in monthly_summary_dict and settings.reporting_ao_monthly_summary_enabled:
                                upload_files.append(create_org_monthly_summary(monthly_summary_dict[ao.id]))
                            upload_files_to_slack(
                                upload_files,
                                settings,
                                text=f"Here is your ({ao.name}) monthly summary! Looking for leaderboards? Find these and more at {os.getenv('STATS_URL')}/stats/region/{org.id}",  # noqa: E501
                                channel=channel,
                            )
                except Exception as e:
                    print(f"Error processing org {org.name} ({org.id}): {e}")
                    continue


def pull_org_leaderboard_data() -> Dict[int, List[OrgUserLeaderboard]]:
    session = get_session()

    # Define reusable date range and month expression
    prior_month = datetime.now().month - 1 if datetime.now().month > 1 else 12
    prior_year = datetime.now().year if datetime.now().month > 1 else datetime.now().year - 1

    # Helper to build a scoped query for a given org id column
    def build_scoped_query(org_id_col, org_name_col, scope_name: str, basis: str = "month"):
        trunc_date = datetime(prior_year, prior_month, 1) if basis == "month" else datetime(prior_year, 1, 1)
        query = (
            select(
                org_id_col.label("org_id"),
                org_name_col.label("org_name"),
                literal(basis).label("basis"),
                AttendanceExpanded.user_id.label("user_id"),
                AttendanceExpanded.f3_name.label("f3_name"),
                AttendanceExpanded.avatar_url.label("avatar_url"),
                func.count(EventInstanceExpanded.id).label("post_count"),
                func.sum(AttendanceExpanded.q_ind + AttendanceExpanded.coq_ind).label("total_qs"),
            )
            .join(AttendanceExpanded, AttendanceExpanded.event_instance_id == EventInstanceExpanded.id)
            .filter(func.date_trunc(basis, EventInstanceExpanded.start_date) == trunc_date)
            .group_by(
                org_id_col,
                org_name_col,
                AttendanceExpanded.user_id,
                AttendanceExpanded.f3_name,
                AttendanceExpanded.avatar_url,
            )
            .order_by(org_id_col, func.count(EventInstanceExpanded.id).desc())
        )
        return query

    # Build queries for AO-scoped and Region-scoped orgs
    query_ao_month = build_scoped_query(
        EventInstanceExpanded.ao_org_id, EventInstanceExpanded.ao_name, "ao", basis="month"
    )
    query_region_month = build_scoped_query(
        EventInstanceExpanded.region_org_id, EventInstanceExpanded.region_name, "region", basis="month"
    )
    query_ao_ytd = build_scoped_query(
        EventInstanceExpanded.ao_org_id, EventInstanceExpanded.ao_name, "ao", basis="year"
    )
    query_region_ytd = build_scoped_query(
        EventInstanceExpanded.region_org_id, EventInstanceExpanded.region_name, "region", basis="year"
    )

    # Union both scopes so the result includes both AO and Region orgs
    final_query = union_all(query_ao_month, query_region_month, query_ao_ytd, query_region_ytd)

    results = session.execute(final_query).all()

    results_dict: Dict[int, List[OrgUserLeaderboard]] = {}
    for row in results:
        org_id = row.org_id
        if org_id not in results_dict:
            results_dict[org_id] = []
        results_dict[org_id].append(OrgUserLeaderboard(**row._asdict()))

    session.close()
    return results_dict


def create_post_leaders_plot(records: List[OrgUserLeaderboard]) -> str:
    # guard for empty input
    if not records:
        print("No records to plot")
        return

    from io import BytesIO

    import matplotlib.pyplot as plt
    import matplotlib.transforms as mtransforms
    import requests
    from matplotlib.offsetbox import AnnotationBbox, OffsetImage
    from PIL import Image

    # Matplotlib export settings to mirror prior pixel density
    DPI = 300
    PX_W = DEFAULT_IMAGE_WIDTH * DEFAULT_IMAGE_SCALE  # e.g., 2400
    PX_H = DEFAULT_IMAGE_HEIGHT * DEFAULT_IMAGE_SCALE
    FIG_W_IN = PX_W / DPI
    FIG_H_IN = PX_H / DPI

    # Avatar/text tuning (in pixels for avatar; text in points)
    AVATAR_PX = 60  # down from 100 so it fits inside bars
    AVATAR_ZOOM = 1.0
    AVATAR_MARGIN_PX = 300  # gap between avatar and username
    USERNAME_FONTSIZE = 24  # slightly smaller to avoid overlap
    VALUE_FONTSIZE = 28  # slightly smaller numbers

    def _fetch_image(url: str) -> Image.Image | None:
        if not url:
            return None
        try:
            resp = requests.get(url, timeout=6)
            resp.raise_for_status()
            return Image.open(BytesIO(resp.content)).convert("RGBA")
        except Exception:
            return None

    def _prepare_avatar(im: Image.Image, target_px: int = AVATAR_PX) -> Image.Image:
        """Center-crop to square and resize to a consistent pixel size to avoid giant avatars."""
        if im is None:
            return None
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        im = im.crop((left, top, left + side, top + side))
        # hard cap so nothing is huge; consistent across all images
        im = im.resize((target_px, target_px), Image.LANCZOS)
        return im

    def create_post_leaders_chart(
        records: List[OrgUserLeaderboard],
        top_n: int = 5,
        basis: str = "month",
        value_field: str = "post_count",
        label: str = "Posts",
        bar_color: str = NEON_GREEN,
    ):
        # filter and sort
        sorted_records = [r for r in records if r.basis == basis]
        sorted_records = sorted(sorted_records, key=lambda r: getattr(r, value_field), reverse=True)[:top_n]
        categories = [r.f3_name for r in sorted_records]
        raw_values = [getattr(r, value_field) for r in sorted_records]
        images = [r.avatar_url for r in sorted_records]

        # normalize numeric values
        values: List[float] = []
        for v in raw_values:
            try:
                values.append(float(v) if v is not None else 0.0)
            except Exception:
                values.append(0.0)

        # padding logic similar to original
        max_value = max(values + [1.0])
        pad = max(max_value * 0.02, 0.3)
        right_pad = pad * 2

        # figure/axes setup
        fig, ax = plt.subplots(figsize=(FIG_W_IN, FIG_H_IN), dpi=DPI)
        bg = "#0B1220"
        fig.patch.set_facecolor(bg)
        ax.set_facecolor(bg)

        y_pos = list(range(len(categories)))
        bar_height = 0.8
        ax.barh(y_pos, values, color=bar_color, height=bar_height, zorder=1)
        ax.invert_yaxis()  # highest value at the top

        # Style: hide ticks/spines/grid
        ax.xaxis.set_ticks([])
        ax.yaxis.set_ticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)

        # Title text (org + month/YTD + label)
        org_name = sorted_records[0].org_name + " " if sorted_records else ""
        if basis == "year":
            prior_month_name = "YTD"
        else:
            prior_month_name = (
                datetime(datetime.now().year, datetime.now().month - 1, 1).strftime("%B")
                if datetime.now().month > 1
                else datetime(datetime.now().year - 1, 12, 1).strftime("%B")
            )
        ax.set_title(f"{org_name}{prior_month_name} {label} Leaders", color="#FFFFFF", fontsize=30, pad=20)

        # Bars start close to the left edge
        ax.set_xlim(0, max_value + right_pad)
        ax.margins(x=0)

        # Place avatars and labels using blended transform (axes-fraction x, data y)
        # - x as axes fraction keeps consistent insets
        # - compute name offset from avatar pixel width to prevent overlap
        trans = mtransforms.blended_transform_factory(ax.transAxes, ax.transData)
        avatar_x_axes = 0.055  # inside-left
        # Convert avatar width + margin (pixels) to axes-fraction to place the name safely to the right
        avatar_width_axes = (AVATAR_PX * AVATAR_ZOOM) / PX_W
        name_offset_axes = (AVATAR_MARGIN_PX) / PX_W
        name_x_axes = avatar_x_axes + avatar_width_axes + name_offset_axes

        # thresholds to decide if text fits inside small bars
        inside_fraction_threshold = 0.16  # if bar < 16% of max, move name/number outside

        for i, (name, val, img_url) in enumerate(zip(categories, values, images, strict=False)):
            # avatar image (normalized so none are huge)
            avatar_im = _fetch_image(img_url) if img_url else None
            avatar_im = _prepare_avatar(avatar_im, target_px=AVATAR_PX) if avatar_im is not None else None
            if avatar_im is not None:
                oi = OffsetImage(avatar_im, zoom=AVATAR_ZOOM)  # fixed pixel size; consistent
                ab = AnnotationBbox(
                    oi,
                    (avatar_x_axes, y_pos[i]),
                    xycoords=trans,
                    frameon=False,
                    box_alignment=(0.0, 0.5),
                    zorder=2,
                )
                ax.add_artist(ab)

            # Decide where to place the username
            fraction_of_max = (val / max_value) if max_value > 0 else 0
            name_inside = fraction_of_max >= inside_fraction_threshold

            if name_inside:
                # inside the bar near left
                ax.text(
                    name_x_axes,
                    y_pos[i],
                    name,
                    transform=trans,
                    va="center",
                    ha="left",
                    color="#0B1220",
                    fontsize=USERNAME_FONTSIZE,  # smaller username
                    zorder=3,
                )
            else:
                # bar too short; put name just outside right in data coords
                ax.text(
                    val + pad,
                    y_pos[i],
                    name,
                    va="center",
                    ha="left",
                    color="#FFFFFF",
                    fontsize=USERNAME_FONTSIZE,
                    zorder=3,
                )

            # numeric label near the bar end (slightly smaller)
            display_label = str(int(val)) if float(val).is_integer() else str(val)
            if val > pad * 2:
                nx = val - pad
                ha = "right"
                color = "#0B1220" if name_inside else "#FFFFFF"
            else:
                nx = val + pad
                ha = "left"
                color = "#FFFFFF"

            ax.text(
                nx,
                y_pos[i],
                display_label,
                va="center",
                ha=ha,
                color=color,
                fontsize=VALUE_FONTSIZE,  # a bit smaller than before
                fontweight="bold",
                zorder=3,
            )

        # save single panel
        out_file = f"{basis}_{label}_leaders.png"
        fig.savefig(out_file, dpi=DPI, facecolor=fig.get_facecolor(), bbox_inches="tight", pad_inches=0.3)
        plt.close(fig)

    # Generate and save the four panels
    create_post_leaders_chart(
        records, top_n=5, basis="month", value_field="post_count", label="Post", bar_color="#39FF14"
    )
    create_post_leaders_chart(
        records, top_n=5, basis="year", value_field="post_count", label="Post", bar_color="#14E4FF"
    )
    create_post_leaders_chart(records, top_n=5, basis="month", value_field="total_qs", label="Q", bar_color="#FF5733")
    create_post_leaders_chart(records, top_n=5, basis="year", value_field="total_qs", label="Q", bar_color="#FFBD33")

    file_name = stitch_2x2(
        [
            "month_Post_leaders.png",
            "year_Post_leaders.png",
            "month_Q_leaders.png",
            "year_Q_leaders.png",
        ],
        out_path="4up_post_leaders.png",
        bg_color=(11, 18, 32),
        padding=10,
    )
    return file_name


def stitch_2x2(
    image_paths: List[str],
    out_path: str = "4up_post_leaders.png",
    bg_color: tuple = (11, 18, 32),
    padding: int = 0,
):
    """Stitch four images into a 2x2 grid and save as a single image.

    - image_paths: list of 4 image file paths in row-major order: [TL, TR, BL, BR]
    - out_path: output file path
    - bg_color: background RGB tuple for the canvas
    - padding: pixels of padding between images

    If the input images differ in size they will be resized to the size of the
    first image to produce a uniform grid.
    """
    from PIL import Image

    if len(image_paths) != 4:
        raise ValueError("image_paths must contain exactly 4 paths (row-major order)")

    imgs = [Image.open(p).convert("RGBA") for p in image_paths]

    # Normalize sizes to the first image
    base_w, base_h = imgs[0].size
    norm_imgs = []
    for im in imgs:
        if im.size != (base_w, base_h):
            im = im.resize((base_w, base_h), Image.LANCZOS)
        norm_imgs.append(im)

    total_w = base_w * 2 + padding
    total_h = base_h * 2 + padding

    canvas = Image.new("RGBA", (total_w, total_h), color=bg_color + (255,))

    # Positions: (0,0), (base_w+padding,0), (0,base_h+padding), (base_w+padding, base_h+padding)
    positions = [(0, 0), (base_w + padding, 0), (0, base_h + padding), (base_w + padding, base_h + padding)]
    for im, pos in zip(norm_imgs, positions, strict=False):
        canvas.paste(im, pos, im)

    # Save as RGB (flatten alpha) for compatibility
    canvas.convert("RGB").save(out_path, dpi=(300, 300))
    return out_path


def create_org_monthly_summary(records: List[OrgMonthlySummary]) -> str:
    # Build three subplots (Posts, Unique PAX, FNGs) with paired series for current and prior year.
    # Only plot points for months that had events (use None for missing months).
    import calendar

    import matplotlib.pyplot as plt
    import mplcyberpunk  # noqa: F401 needed for plt.style.

    plt.style.use("cyberpunk")
    fig, axs = plt.subplots(nrows=3, ncols=1, figsize=(12, 10), sharex=True)

    now = datetime.now()
    current_year = now.year
    current_month = now.month

    # Build rolling 12-month window ending with the prior month
    # E.g., if current is March 2026, we show Apr 2025 -> Mar 2026 (but Mar 2026 data may be incomplete)
    # So we end with the prior month: Mar 2025 -> Feb 2026
    rolling_months = []  # List of (year, month) tuples
    for i in range(12, 0, -1):  # 12 months back to prior month
        m = current_month - i
        y = current_year
        while m <= 0:
            m += 12
            y -= 1
        rolling_months.append((y, m))

    # Month labels for the x-axis (abbreviated month names)
    month_labels = [calendar.month_abbr[m] for _, m in rolling_months]

    # Determine date range for title (e.g., "Mar 2025 - Feb 2026")
    first_month_year, first_month = rolling_months[0]
    last_month_year, last_month = rolling_months[-1]
    first_abbr = calendar.month_abbr[first_month]
    last_abbr = calendar.month_abbr[last_month]
    current_range = f"{first_abbr} {first_month_year} - {last_abbr} {last_month_year}"
    prior_range = f"{first_abbr} {first_month_year - 1} - {last_abbr} {last_month_year - 1}"

    def aggregate_rolling(year_offset: int):
        """Aggregate data for rolling 12 months with given year offset.
        year_offset=0 means current rolling period
        year_offset=-1 means prior year (same months, one year earlier)
        """
        posts: List[int | None] = []
        uniques: List[int | None] = []
        fngs: List[int | None] = []
        for y, m in rolling_months:
            target_year = y + year_offset
            month_event = next(
                (event for event in records if event.month.year == target_year and event.month.month == m), None
            )
            if month_event and (month_event.event_count or 0) > 0:
                posts.append(month_event.total_posts)
                uniques.append(month_event.unique_pax_count)
                fngs.append(month_event.total_fngs)
            else:
                posts.append(None)
                uniques.append(None)
                fngs.append(None)
        return posts, uniques, fngs

    posts_current, uniques_current, fngs_current = aggregate_rolling(0)
    posts_prior, uniques_prior, fngs_prior = aggregate_rolling(-1)

    # Colors per metric; prior year uses same color with transparency and dashed style
    COLOR_POSTS = "#39FF14"  # neon green
    COLOR_UNIQUES = "#FF5733"
    COLOR_FNGS = "#33D6FF"

    # Subplot 1: Total Posts
    ax = axs[0]
    ax.plot(
        month_labels,
        posts_prior,
        label=prior_range,
        color=COLOR_POSTS,
        alpha=0.25,
        marker="o",
        linestyle="--",
    )
    ax.plot(
        month_labels,
        posts_current,
        label=current_range,
        color=COLOR_POSTS,
        alpha=0.95,
        marker="o",
    )
    ax.set_title("Total Posts", fontsize=14)
    # ax.set_ylabel("Total Posts", fontsize=12)
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper left")
    mplcyberpunk.add_glow_effects(ax=ax, gradient_fill=False)

    # Subplot 2: Unique PAX
    ax = axs[1]
    ax.plot(
        month_labels,
        uniques_prior,
        label=prior_range,
        color=COLOR_UNIQUES,
        alpha=0.25,
        marker="o",
        linestyle="--",
    )
    ax.plot(
        month_labels,
        uniques_current,
        label=current_range,
        color=COLOR_UNIQUES,
        alpha=0.95,
        marker="o",
    )
    ax.set_title("Unique PAX", fontsize=14)
    # ax.set_ylabel("Unique PAX", fontsize=12)
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper left")
    mplcyberpunk.add_glow_effects(ax=ax, gradient_fill=False)

    # Subplot 3: FNGs
    ax = axs[2]
    ax.plot(
        month_labels,
        fngs_current,
        label=current_range,
        color=COLOR_FNGS,
        alpha=0.95,
        marker="o",
    )
    ax.plot(
        month_labels,
        fngs_prior,
        label=prior_range,
        color=COLOR_FNGS,
        alpha=0.25,
        marker="o",
        linestyle="--",
    )

    ax.set_title("FNGs", fontsize=14)
    # ax.set_ylabel("FNGs", fontsize=12)
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper left")
    mplcyberpunk.add_glow_effects(ax=ax, gradient_fill=False)

    fig.suptitle("Monthly Attendance — Rolling 12 Months", fontsize=16)
    # axs[-1].set_xlabel("Month", fontsize=14)
    plt.setp(axs[-1].get_xticklabels(), rotation=45)
    plt.tight_layout(rect=[0, 0, 1, 0.97])
    plt.savefig("org_monthly_attendance.png", dpi=300)
    plt.close()

    return "org_monthly_attendance.png"


def pull_org_summary_data() -> Dict[int, List[OrgMonthlySummary]]:
    session = get_session()

    # Define reusable date range and month expression
    # Pull 2 years of data to support rolling 12-month view with prior year comparison
    start_date = datetime(datetime.now().year - 2, 1, 1)
    end_date = datetime(datetime.now().year, datetime.now().month, 1)
    month_expr = func.date_trunc("month", EventInstanceExpanded.start_date)

    # Helper to build a scoped query for a given org id column
    def build_scoped_query(org_id_col, scope_name: str):
        # Subquery of events (one row per event) to avoid duplication from Attendance joins
        events_subq = (
            select(
                org_id_col.label("org_id"),
                month_expr.label("month"),
                EventInstanceExpanded.id.label("event_id"),
                EventInstanceExpanded.pax_count.label("pax_count"),
                EventInstanceExpanded.fng_count.label("fng_count"),
            )
            .where(
                and_(
                    EventInstanceExpanded.start_date >= start_date,
                    EventInstanceExpanded.start_date < end_date,
                )
            )
            .subquery(f"events_subq_{scope_name}")
        )

        # Aggregate event-level metrics (counts and sums) from the deduplicated events
        events_agg = (
            select(
                events_subq.c.org_id,
                events_subq.c.month,
                func.count(events_subq.c.event_id).label("event_count"),
                func.sum(events_subq.c.pax_count).label("total_posts"),
                func.sum(events_subq.c.fng_count).label("total_fngs"),
            )
            .group_by(events_subq.c.org_id, events_subq.c.month)
            .subquery(f"events_agg_{scope_name}")
        )

        # Distinct attendance per org, month, user to count unique pax across all events in that month
        attendance_distinct = (
            select(
                org_id_col.label("org_id"),
                month_expr.label("month"),
                AttendanceExpanded.user_id.label("user_id"),
            )
            .select_from(EventInstanceExpanded)
            .join(AttendanceExpanded, AttendanceExpanded.event_instance_id == EventInstanceExpanded.id)
            .where(
                and_(
                    EventInstanceExpanded.start_date >= start_date,
                    EventInstanceExpanded.start_date < end_date,
                )
            )
            .distinct()
            .subquery(f"attendance_distinct_{scope_name}")
        )

        attendance_agg = (
            select(
                attendance_distinct.c.org_id,
                attendance_distinct.c.month,
                func.count().label("unique_pax_count"),
            )
            .group_by(attendance_distinct.c.org_id, attendance_distinct.c.month)
            .subquery(f"attendance_agg_{scope_name}")
        )

        # Final join of event aggregates with unique pax counts
        scoped_query = select(
            events_agg.c.org_id.label("org_id"),
            events_agg.c.month.label("month"),
            events_agg.c.event_count,
            events_agg.c.total_posts,
            events_agg.c.total_fngs,
            func.coalesce(attendance_agg.c.unique_pax_count, 0).label("unique_pax_count"),
        ).select_from(
            events_agg.outerjoin(
                attendance_agg,
                and_(
                    events_agg.c.org_id == attendance_agg.c.org_id,
                    events_agg.c.month == attendance_agg.c.month,
                ),
            )
        )
        return scoped_query

    # Build queries for AO-scoped and Region-scoped orgs
    query_ao = build_scoped_query(EventInstanceExpanded.ao_org_id, "ao")
    query_region = build_scoped_query(EventInstanceExpanded.region_org_id, "region")

    # Union both scopes so the result includes both AO and Region orgs
    final_query = union_all(query_ao, query_region)

    results = session.execute(final_query).all()

    results_dict: Dict[int, List[OrgMonthlySummary]] = {}
    for row in results:
        org_id = row.org_id
        if org_id not in results_dict:
            results_dict[org_id] = []
        results_dict[org_id].append(OrgMonthlySummary(**row._asdict()))

    session.close()
    return results_dict


def run_monthly_summaries(run_org_id: int = None):
    summary_dict = pull_org_summary_data()

    if run_org_id is not None and run_org_id in summary_dict:
        create_org_monthly_summary(summary_dict[run_org_id])
    else:
        for _, records in summary_dict.items():
            create_org_monthly_summary(records)


if __name__ == "__main__":
    # run_monthly_summaries(run_org_id=38451)
    cycle_all_orgs(run_org_id=29307)
