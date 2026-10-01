import unittest

from app.dji.normalizer import normalize_dji_payload, telemetry_point_fields


class DjiNormalizerTests(unittest.TestCase):
    def test_zero_coordinates_are_valid(self):
        normalized = normalize_dji_payload({
            "data": {
                "latitude": 0.0,
                "longitude": 0.0,
                "height": 42.5,
                "elevation": 3.0,
            }
        })
        point = telemetry_point_fields(normalized)
        self.assertIsNotNone(point)
        self.assertEqual(point["lat"], 0.0)
        self.assertEqual(point["lon"], 0.0)
        self.assertEqual(point["height"], 42.5)
        self.assertEqual(point["elevation"], 3.0)

    def test_m3m_camera_and_gimbal_are_normalized_by_payload_index(self):
        normalized = normalize_dji_payload({
            "data": {
                "cameras": [{
                    "payload_index": "68-0-0",
                    "camera_mode": 1,
                    "zoom_factor": 2.0,
                }],
                "68-0-0": {
                    "gimbal_pitch": -45.5,
                    "gimbal_roll": 1.25,
                    "gimbal_yaw": 123.4,
                },
            }
        })
        self.assertEqual(normalized["cameras"][0]["payload_index"], "68-0-0")
        self.assertEqual(normalized["gimbals"]["68-0-0"]["pitch_deg"], -45.5)
        self.assertIn("telemetry.camera", normalized["capabilities"])
        self.assertIn("telemetry.gimbal", normalized["capabilities"])

    def test_rtk_status_is_exposed_without_overclaiming_fixed(self):
        normalized = normalize_dji_payload({
            "data": {
                "position_state": {
                    "is_fixed": 2,
                    "quality": 5,
                    "gps_number": 20,
                    "rtk_number": 24,
                }
            }
        })
        self.assertFalse(normalized["navigation"]["rtk"]["is_fixed"])
        self.assertIn("telemetry.rtk", normalized["capabilities"])


if __name__ == "__main__":
    unittest.main()
