import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from scripts.weekly_reporting import (
    BIWEEKLY_EPOCH_MONDAY,
    DEFAULT_WEEKLY_SECTIONS,
    DEFAULT_WEEKLY_SUMMARY_METRICS,
    FLAG_HOLDER_FALLBACK,
    FLAG_HOLDER_LOCATION,
    FLAG_HOLDER_PAX,
    SUMMARY_METRIC_AVG_PAX,
    SUMMARY_METRIC_TOTAL_EVENTS,
    SUMMARY_METRIC_UNIQUE_PAX,
    WEEKLY_SECTION_FLAGS,
    WEEKLY_SECTION_FNGS,
    WEEKLY_SECTION_SUMMARY,
    WEEKLY_SECTION_TOP_QS,
    FlagCandidate,
    WeeklyAttendanceRecord,
    WeeklyEvent,
    ao_label,
    build_flag_pattern,
    build_weekly_report_text,
    compute_weekly_stats,
    extract_fng_names,
    is_biweekly_send_week,
    report_window_days,
    resolve_custom_field_holder,
    resolve_location_holder,
    resolve_org_flags,
)
from utilities.database.orm import SlackSettings


def _make_event(
    event_id=1,
    name="Beatdown",
    start_date=date(2026, 7, 20),
    ao_org_id=100,
    ao_name="The Landing",
    ao_channel_id=None,
    pax_count=None,
    fng_count=None,
    backblast=None,
):
    return WeeklyEvent(
        event_id=event_id,
        name=name,
        start_date=start_date,
        ao_org_id=ao_org_id,
        ao_name=ao_name,
        ao_channel_id=ao_channel_id,
        pax_count=pax_count,
        fng_count=fng_count,
        backblast=backblast,
    )


def _make_attendance(event_id=1, user_id=1, f3_name="Roma", q_ind=0):
    return WeeklyAttendanceRecord(event_id=event_id, user_id=user_id, f3_name=f3_name, q_ind=q_ind)


def _make_region_record(**kwargs):
    return SlackSettings(team_id="T123", org_id=50049, **kwargs)


class TestAoLabel(unittest.TestCase):
    def test_uses_channel_mention_when_channel_known(self):
        self.assertEqual(ao_label("The Landing", "C12345"), "<#C12345>")

    def test_slugifies_ao_name_without_channel(self):
        self.assertEqual(ao_label("Field of Dreams!", None), "#field-of-dreams")

    def test_handles_missing_name(self):
        self.assertEqual(ao_label(None, None), "#unknown")


class TestExtractFngNames(unittest.TestCase):
    def test_extracts_names_after_count(self):
        backblast = "Q: Roma\nFNGs: 2 Apollo, Beaker\nCOUNT: 10"
        self.assertEqual(extract_fng_names(backblast), ["Apollo", "Beaker"])

    def test_filters_none_placeholders(self):
        self.assertEqual(extract_fng_names("FNGs: 0 None\nCOUNT: 5"), [])

    def test_no_fng_line(self):
        self.assertEqual(extract_fng_names("COUNT: 5"), [])
        self.assertEqual(extract_fng_names(None), [])


class TestBuildFlagPattern(unittest.TestCase):
    def test_matches_hashtag_variations_for_multiword_core(self):
        pattern = build_flag_pattern("ghost flag")
        for tag in ("#ghostflag", "#GhostFlag", "#ghost-flag", "#f3ghostflag", "#nwpghostflag", "#nwp-ghost-flag"):
            self.assertTrue(pattern.search(f"Great beatdown! {tag} was planted"), tag)

    def test_matches_single_word_core(self):
        pattern = build_flag_pattern("pirateflag")
        self.assertTrue(pattern.search("The #pirateflag was defended!"))

    def test_does_not_match_unrelated_text(self):
        pattern = build_flag_pattern("him belt")
        self.assertFalse(pattern.search("we saw a ghost out there, no flag though"))

    def test_empty_hashtag_never_matches(self):
        pattern = build_flag_pattern("")
        self.assertFalse(pattern.search("#anything"))


class TestResolveLocationHolder(unittest.TestCase):
    def _candidate(self, start_date, text, ao_name="Field of Dreams", ao_channel_id=None, in_preblast=False):
        return FlagCandidate(
            start_date=start_date,
            ao_name=ao_name,
            ao_channel_id=ao_channel_id,
            preblast=text if in_preblast else None,
            backblast=None if in_preblast else text,
            meta=None,
        )

    def test_uses_ao_label(self):
        pattern = build_flag_pattern("ghost flag")
        candidates = [self._candidate(date(2026, 7, 20), "#ghostflag was planted")]
        self.assertEqual(resolve_location_holder(candidates, pattern), "#field-of-dreams")

    def test_matches_in_preblast(self):
        pattern = build_flag_pattern("ghost flag")
        candidates = [self._candidate(date(2026, 7, 20), "Bring the #ghostflag!", in_preblast=True)]
        self.assertEqual(resolve_location_holder(candidates, pattern), "#field-of-dreams")

    def test_most_recent_event_wins(self):
        pattern = build_flag_pattern("ghost flag")
        candidates = [
            self._candidate(date(2026, 7, 1), "#ghostflag", ao_name="The Landing"),
            self._candidate(date(2026, 7, 20), "#ghostflag", ao_name="The Hub", ao_channel_id="CHUB"),
        ]
        self.assertEqual(resolve_location_holder(candidates, pattern), "<#CHUB>")

    def test_empty_candidates(self):
        pattern = build_flag_pattern("ghost flag")
        self.assertIsNone(resolve_location_holder([], pattern))


class TestResolveCustomFieldHolder(unittest.TestCase):
    def _candidate(self, start_date, meta=None):
        return FlagCandidate(
            start_date=start_date,
            ao_name="Field of Dreams",
            ao_channel_id=None,
            preblast=None,
            backblast=None,
            meta=meta,
        )

    def test_pax_reads_custom_field_value_from_most_recent_event(self):
        candidates = [
            self._candidate(date(2026, 7, 1), meta={"HIM Belt Holder": "Zubat"}),
            self._candidate(date(2026, 7, 20), meta={"HIM Belt Holder": "Roma"}),
        ]
        self.assertEqual(resolve_custom_field_holder(candidates, "HIM Belt Holder", FLAG_HOLDER_PAX), "@Roma")

    def test_pax_already_at_mentioned_value_not_double_prefixed(self):
        candidates = [self._candidate(date(2026, 7, 20), meta={"HIM Belt Holder": "@Roma"})]
        self.assertEqual(resolve_custom_field_holder(candidates, "HIM Belt Holder", FLAG_HOLDER_PAX), "@Roma")

    def test_pax_slack_mention_value_not_double_prefixed(self):
        candidates = [self._candidate(date(2026, 7, 20), meta={"HIM Belt Holder": "<@U0123456>"})]
        self.assertEqual(resolve_custom_field_holder(candidates, "HIM Belt Holder", FLAG_HOLDER_PAX), "<@U0123456>")

    def test_location_channel_mention_value_not_double_formatted(self):
        candidates = [self._candidate(date(2026, 7, 20), meta={"Ghost Flag AO": "<#C0123456>"})]
        self.assertEqual(resolve_custom_field_holder(candidates, "Ghost Flag AO", FLAG_HOLDER_LOCATION), "<#C0123456>")

    def test_location_plain_typed_value_gets_slugified(self):
        candidates = [self._candidate(date(2026, 7, 20), meta={"Ghost Flag AO": "South End Station"})]
        self.assertEqual(
            resolve_custom_field_holder(candidates, "Ghost Flag AO", FLAG_HOLDER_LOCATION),
            "#south-end-station",
        )

    def test_skips_events_missing_the_field_to_find_most_recent_set_value(self):
        candidates = [
            self._candidate(date(2026, 7, 20), meta={"Other Field": "x"}),
            self._candidate(date(2026, 7, 10), meta={"HIM Belt Holder": "Bramble"}),
        ]
        self.assertEqual(resolve_custom_field_holder(candidates, "HIM Belt Holder", FLAG_HOLDER_PAX), "@Bramble")

    def test_no_custom_field_name_returns_none(self):
        candidates = [self._candidate(date(2026, 7, 20), meta={"HIM Belt Holder": "Roma"})]
        self.assertIsNone(resolve_custom_field_holder(candidates, "", FLAG_HOLDER_PAX))

    def test_never_set_returns_none(self):
        candidates = [self._candidate(date(2026, 7, 20), meta={})]
        self.assertIsNone(resolve_custom_field_holder(candidates, "HIM Belt Holder", FLAG_HOLDER_PAX))


class TestResolveOrgFlags(unittest.TestCase):
    def _candidate(self, start_date, text=None, ao_name="Field of Dreams", meta=None):
        return FlagCandidate(
            start_date=start_date, ao_name=ao_name, ao_channel_id=None, preblast=None, backblast=text, meta=meta
        )

    def test_resolves_multiple_flags_in_configured_order(self):
        flags_config = {
            "ghost-flag": {
                "name": "Ghost Flag",
                "hashtag": "ghost flag",
                "holder_type": FLAG_HOLDER_LOCATION,
                "enabled": True,
            },
            "him-belt": {
                "name": "HIM Belt",
                "custom_field_name": "HIM Belt Holder",
                "holder_type": FLAG_HOLDER_PAX,
                "enabled": True,
            },
        }
        candidates = [
            self._candidate(date(2026, 7, 20), text="#ghostflag planted"),
            self._candidate(date(2026, 7, 21), meta={"HIM Belt Holder": "Bramble"}),
        ]
        resolved = resolve_org_flags(flags_config, candidates)
        self.assertEqual(resolved, [("Ghost Flag", "#field-of-dreams"), ("HIM Belt", "@Bramble")])

    def test_disabled_flags_are_skipped(self):
        flags_config = {
            "ghost-flag": {
                "name": "Ghost Flag",
                "hashtag": "ghost flag",
                "holder_type": FLAG_HOLDER_LOCATION,
                "enabled": False,
            },
        }
        candidates = [self._candidate(date(2026, 7, 20), text="#ghostflag planted")]
        self.assertEqual(resolve_org_flags(flags_config, candidates), [])

    def test_unmatched_flag_uses_fallback(self):
        flags_config = {
            "ghost-flag": {
                "name": "Ghost Flag",
                "hashtag": "ghost flag",
                "holder_type": FLAG_HOLDER_LOCATION,
                "enabled": True,
            },
        }
        self.assertEqual(resolve_org_flags(flags_config, []), [("Ghost Flag", FLAG_HOLDER_FALLBACK)])

    def test_pax_flag_without_custom_field_name_uses_fallback(self):
        flags_config = {
            "him-belt": {"name": "HIM Belt", "holder_type": FLAG_HOLDER_PAX, "enabled": True},
        }
        candidates = [self._candidate(date(2026, 7, 20), meta={"HIM Belt Holder": "Roma"})]
        self.assertEqual(resolve_org_flags(flags_config, candidates), [("HIM Belt", FLAG_HOLDER_FALLBACK)])

    def test_location_flag_prefers_custom_field_over_hashtag_when_both_set(self):
        flags_config = {
            "ghost-flag": {
                "name": "Ghost Flag",
                "hashtag": "ghost flag",
                "custom_field_name": "Ghost Flag AO",
                "holder_type": FLAG_HOLDER_LOCATION,
                "enabled": True,
            },
        }
        # only the custom field is populated on this candidate; the hashtag never appears in
        # the text, proving the custom field path is used rather than falling through to text
        candidates = [self._candidate(date(2026, 7, 20), text="no hashtag here", meta={"Ghost Flag AO": "<#CFOD>"})]
        self.assertEqual(resolve_org_flags(flags_config, candidates), [("Ghost Flag", "<#CFOD>")])

    def test_location_flag_falls_back_to_hashtag_without_custom_field(self):
        flags_config = {
            "ghost-flag": {
                "name": "Ghost Flag",
                "hashtag": "ghost flag",
                "holder_type": FLAG_HOLDER_LOCATION,
                "enabled": True,
            },
        }
        candidates = [self._candidate(date(2026, 7, 20), text="#ghostflag planted")]
        self.assertEqual(resolve_org_flags(flags_config, candidates), [("Ghost Flag", "#field-of-dreams")])

    def test_none_config_returns_empty(self):
        self.assertEqual(resolve_org_flags(None, []), [])


class TestComputeWeeklyStats(unittest.TestCase):
    def _fixture(self):
        events = [
            _make_event(
                event_id=1,
                ao_org_id=100,
                ao_name="The Landing",
                pax_count=25,
                fng_count=1,
                backblast="FNGs: 1 Dumpster Fire\nCOUNT: 25",
            ),
            _make_event(event_id=2, ao_org_id=100, ao_name="The Landing", pax_count=10),
            _make_event(
                event_id=3, ao_org_id=200, ao_name="The Hub", ao_channel_id="CHUB", pax_count=None
            ),  # falls back to tagged attendance
        ]
        attendance = [
            _make_attendance(event_id=1, user_id=1, f3_name="Bramble", q_ind=1),
            _make_attendance(event_id=1, user_id=2, f3_name="Roma"),
            _make_attendance(event_id=2, user_id=1, f3_name="Bramble", q_ind=1),
            _make_attendance(event_id=3, user_id=3, f3_name="Zubat", q_ind=1),
            _make_attendance(event_id=3, user_id=2, f3_name="Roma"),
            _make_attendance(event_id=3, user_id=2, f3_name="Roma"),  # duplicate row is deduped
        ]
        return events, attendance

    def test_summary_numbers(self):
        stats = compute_weekly_stats(*self._fixture())
        self.assertEqual(stats.total_events, 3)
        self.assertEqual(stats.ao_count, 2)
        self.assertEqual(stats.unique_qs, 2)  # Bramble + Zubat
        self.assertEqual(stats.fng_count, 1)
        self.assertEqual(stats.unique_pax, 3)
        # avg mirrors pax-vault's AVG(pax_count): only events with a recorded count
        self.assertEqual(stats.avg_pax, round((25 + 10) / 2, 2))

    def test_avg_pax_falls_back_to_tagged_when_no_recorded_counts(self):
        events = [_make_event(event_id=1, pax_count=None)]
        attendance = [
            _make_attendance(event_id=1, user_id=1, f3_name="Bramble"),
            _make_attendance(event_id=1, user_id=2, f3_name="Roma"),
        ]
        stats = compute_weekly_stats(events, attendance)
        self.assertEqual(stats.avg_pax, 2.0)

    def test_fngs_by_ao(self):
        stats = compute_weekly_stats(*self._fixture())
        self.assertEqual(stats.fngs_by_ao, [(1, "#the-landing", "@Dumpster Fire")])

    def test_top_ao_events(self):
        stats = compute_weekly_stats(*self._fixture())
        self.assertEqual(len(stats.top_ao_events), 2)
        attendance_count, label, q_name, title = stats.top_ao_events[0]
        self.assertEqual(attendance_count, 25)
        self.assertEqual(label, "#the-landing")
        self.assertEqual(q_name, "@Bramble")
        self.assertIn("Beatdown (", title)
        self.assertEqual(stats.top_ao_events[1][1], "<#CHUB>")

    def test_top_posters_and_qs(self):
        stats = compute_weekly_stats(*self._fixture())
        self.assertEqual(stats.top_posters, [(2, "Bramble"), (2, "Roma"), (1, "Zubat")])
        self.assertEqual(stats.top_qs, [(2, "Bramble"), (1, "Zubat")])

    def test_empty_events(self):
        stats = compute_weekly_stats([], [])
        self.assertEqual(stats.total_events, 0)
        self.assertEqual(stats.fngs_by_ao, [])


class TestBuildWeeklyReportText(unittest.TestCase):
    def _stats(self):
        events = [
            _make_event(event_id=1, pax_count=10, fng_count=1, backblast="FNGs: 1 Apollo\nCOUNT: 10"),
        ]
        attendance = [_make_attendance(event_id=1, user_id=1, f3_name="Bramble", q_ind=1)]
        return compute_weekly_stats(events, attendance)

    def test_default_template_renders_placeholders(self):
        record = _make_region_record()
        text = build_weekly_report_text(record, self._stats())
        self.assertIn("• Total Events: 1 Workouts", text)
        self.assertIn("• FNGs: 1 FNGs :fire:", text)

    def test_title_always_present(self):
        record = _make_region_record()
        text = build_weekly_report_text(record, self._stats())
        self.assertTrue(text.startswith("*Weekly Region Report*"))

    def test_no_slack_custom_emoji(self):
        # :slack: is Slack's own bundled logo glyph, not a standard Unicode emoji — some
        # regions' workspaces may not reliably render it, so it must never appear.
        record = _make_region_record(weekly_report_sections=None)
        stats = self._stats()
        stats.flags = [("Ghost Flag", "#field-of-dreams")]
        text = build_weekly_report_text(record, stats)
        self.assertNotIn(":slack:", text)

    def test_flags_section_renders_configured_flags(self):
        record = _make_region_record(
            weekly_report_sections=[WEEKLY_SECTION_FLAGS],
        )
        stats = self._stats()
        stats.flags = [("Ghost Flag", "#field-of-dreams"), ("HIM Belt", FLAG_HOLDER_FALLBACK)]
        text = build_weekly_report_text(record, stats)
        self.assertIn("• Ghost Flag — #field-of-dreams", text)
        self.assertIn(f"• HIM Belt — {FLAG_HOLDER_FALLBACK}", text)

    def test_flags_section_omitted_when_no_flags_configured(self):
        record = _make_region_record(weekly_report_sections=[WEEKLY_SECTION_FLAGS])
        stats = self._stats()
        stats.flags = []
        text = build_weekly_report_text(record, stats)
        self.assertNotIn("*Trophies*", text)

    def test_section_header_override_replaces_default(self):
        record = _make_region_record(
            weekly_report_sections=[WEEKLY_SECTION_FLAGS], weekly_report_flags_header="*Custom Trophy Header* :wave:"
        )
        stats = self._stats()
        stats.flags = [("Ghost Flag", "#field-of-dreams")]
        text = build_weekly_report_text(record, stats)
        self.assertIn("*Custom Trophy Header* :wave:", text)
        self.assertNotIn("*Trophies*", text)

    def test_blank_section_header_override_falls_back_to_default(self):
        record = _make_region_record(weekly_report_sections=[WEEKLY_SECTION_FLAGS], weekly_report_flags_header="")
        stats = self._stats()
        stats.flags = [("Ghost Flag", "#field-of-dreams")]
        text = build_weekly_report_text(record, stats)
        self.assertIn("*Trophies*", text)

    def test_records_render_in_default_template(self):
        record = _make_region_record()
        stats = self._stats()
        stats.avg_pax_record = 12.16
        stats.unique_pax_record = 188
        text = build_weekly_report_text(record, stats)
        self.assertIn("(current record: 12.16)", text)
        self.assertIn("(current record: 188)", text)

    def test_custom_template(self):
        record = _make_region_record(
            weekly_report_intro_template="We had {total_events} events and {unknown_placeholder}!"
        )
        text = build_weekly_report_text(record, self._stats())
        self.assertIn("We had 1 events and {unknown_placeholder}!", text)

    def test_malformed_template_falls_back_to_default(self):
        record = _make_region_record(weekly_report_intro_template="Broken {")
        text = build_weekly_report_text(record, self._stats())
        self.assertIn("• Total Events: 1 Workouts", text)

    def test_sections_are_respected(self):
        record = _make_region_record(weekly_report_sections=[WEEKLY_SECTION_TOP_QS])
        text = build_weekly_report_text(record, self._stats())
        self.assertNotIn("Total Events", text)
        self.assertIn("@Bramble", text)

    def test_none_sections_defaults_to_all(self):
        record = _make_region_record(weekly_report_sections=None)
        text = build_weekly_report_text(record, self._stats())
        for marker in ("Total Events", "New Guys", "Highest Attended Workout", "Top Posters", "Top Qs"):
            self.assertIn(marker, text)

    def test_empty_fngs_section_omitted(self):
        record = _make_region_record(weekly_report_sections=[WEEKLY_SECTION_SUMMARY, WEEKLY_SECTION_FNGS])
        events = [_make_event(event_id=1, pax_count=5)]
        stats = compute_weekly_stats(events, [])
        text = build_weekly_report_text(record, stats)
        self.assertNotIn("New Guys", text)

    def test_default_sections_constant_covers_all_options(self):
        self.assertEqual(len(DEFAULT_WEEKLY_SECTIONS), 6)

    def test_default_summary_metrics_constant_covers_all_options(self):
        self.assertEqual(len(DEFAULT_WEEKLY_SUMMARY_METRICS), 6)

    def test_summary_metrics_are_individually_toggleable(self):
        record = _make_region_record(
            weekly_report_summary_metrics=[SUMMARY_METRIC_TOTAL_EVENTS, SUMMARY_METRIC_AVG_PAX]
        )
        text = build_weekly_report_text(record, self._stats())
        self.assertIn("Total Events: 1 Workouts", text)
        self.assertIn("Average PAX:", text)
        self.assertNotIn("AO Count:", text)
        self.assertNotIn("Unique Qs:", text)
        self.assertNotIn("FNGs: 1 FNGs", text)
        self.assertNotIn("Unique PAX:", text)

    def test_summary_metrics_none_defaults_to_all(self):
        record = _make_region_record(weekly_report_summary_metrics=None)
        text = build_weekly_report_text(record, self._stats())
        for marker in ("Total Events:", "AO Count:", "Unique Qs:", "FNGs:", "Average PAX:"):
            self.assertIn(marker, text)

    def test_summary_metrics_empty_list_shows_only_header(self):
        record = _make_region_record(weekly_report_summary_metrics=[])
        text = build_weekly_report_text(record, self._stats())
        self.assertIn("Here goes the numbers from last week", text)
        self.assertNotIn("Total Events:", text)

    def test_single_metric_order_is_fixed_regardless_of_list_order(self):
        record = _make_region_record(
            weekly_report_summary_metrics=[SUMMARY_METRIC_UNIQUE_PAX, SUMMARY_METRIC_TOTAL_EVENTS]
        )
        text = build_weekly_report_text(record, self._stats())
        self.assertLess(text.index("Total Events:"), text.index("Unique PAX:"))

    def test_unique_pax_metric_alone_still_renders(self):
        record = _make_region_record(weekly_report_summary_metrics=[SUMMARY_METRIC_UNIQUE_PAX])
        text = build_weekly_report_text(record, self._stats())
        self.assertIn("Unique PAX:", text)
        self.assertNotIn("Total Events:", text)


class TestBiweeklyScheduling(unittest.TestCase):
    def test_epoch_monday_itself_is_a_send_week(self):
        self.assertTrue(is_biweekly_send_week(BIWEEKLY_EPOCH_MONDAY))

    def test_one_week_after_epoch_is_not_a_send_week(self):
        self.assertFalse(is_biweekly_send_week(BIWEEKLY_EPOCH_MONDAY + timedelta(days=7)))

    def test_two_weeks_after_epoch_is_a_send_week(self):
        self.assertTrue(is_biweekly_send_week(BIWEEKLY_EPOCH_MONDAY + timedelta(days=14)))

    def test_any_day_within_the_send_week_matches(self):
        # parity is based on whole weeks elapsed, not weekday, so day 3 of an "off" week
        # should still read as not-due same as day 0 of that week
        self.assertFalse(is_biweekly_send_week(BIWEEKLY_EPOCH_MONDAY + timedelta(days=10)))

    def test_report_window_days_weekly_default(self):
        self.assertEqual(report_window_days(None), 7)
        self.assertEqual(report_window_days("weekly"), 7)

    def test_report_window_days_biweekly(self):
        self.assertEqual(report_window_days("biweekly"), 14)


if __name__ == "__main__":
    unittest.main()
