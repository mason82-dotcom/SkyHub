import unittest

from app.dji.protocol import (
    DjiProtocolValueError,
    LIVE_URL_TYPES,
    VIDEO_QUALITIES,
    build_video_id,
    classify_topic,
    ensure_allowed_service_method,
    service_topic,
    validate_video_quality,
)


class DjiProtocolTests(unittest.TestCase):
    def test_classifies_demo_cloud_api_topics(self):
        self.assertEqual(classify_topic("sys/product/ABC123/status"), ("status", "ABC123"))
        self.assertEqual(classify_topic("thing/product/ABC123/osd"), ("osd", "ABC123"))
        self.assertEqual(
            classify_topic("thing/product/ABC123/services_reply"),
            ("services_reply", "ABC123"),
        )
        self.assertEqual(
            classify_topic("thing/product/ABC123/property/set_reply"),
            ("property_set_reply", "ABC123"),
        )
        self.assertEqual(
            classify_topic("thing/product/ABC123/drc/up"),
            ("drc_up", "ABC123"),
        )

    def test_rejects_non_reference_topic_shapes(self):
        self.assertIsNone(classify_topic("thing/product/RC-PRO/osd"))
        self.assertIsNone(classify_topic("thing/product/ABC_123/osd"))
        self.assertIsNone(classify_topic("thing/product/ABC123/unknown"))

    def test_livestream_enum_values_match_reference_contract(self):
        self.assertEqual(LIVE_URL_TYPES[1], "rtmp")
        self.assertEqual(VIDEO_QUALITIES[0], "auto")
        self.assertEqual(VIDEO_QUALITIES[4], "ultra_hd")
        for value in range(5):
            self.assertEqual(validate_video_quality(value), value)
        with self.assertRaises(DjiProtocolValueError):
            validate_video_quality(5)

    def test_builds_video_id_and_validates_inputs(self):
        self.assertEqual(
            build_video_id("AIRCRAFT123", "68-0-0"),
            "AIRCRAFT123/68-0-0/normal-0",
        )
        with self.assertRaises(DjiProtocolValueError):
            build_video_id("BAD/SN", "68-0-0")
        with self.assertRaises(DjiProtocolValueError):
            build_video_id("AIRCRAFT123", "bad-camera")

    def test_outgoing_service_topic_is_serial_safe(self):
        self.assertEqual(service_topic("RC123"), "thing/product/RC123/services")
        with self.assertRaises(DjiProtocolValueError):
            service_topic("RC/invalid")

    def test_service_forwarding_is_fail_closed(self):
        self.assertEqual(
            ensure_allowed_service_method("live_start_push"),
            "live_start_push",
        )
        self.assertEqual(
            ensure_allowed_service_method("live_stop_push"),
            "live_stop_push",
        )
        for method in ("unsupported_method", "future_control_method"):
            with self.assertRaises(DjiProtocolValueError):
                ensure_allowed_service_method(method)


if __name__ == "__main__":
    unittest.main()
