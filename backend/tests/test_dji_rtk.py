import unittest

from app.dji.rtk import RtkFixMonitor, parse_dji_rtk_status


class DjiRtkTests(unittest.TestCase):
    def test_gps_only_does_not_claim_rtk(self):
        status = parse_dji_rtk_status({
            "data": {
                "position_state": {
                    "gps_number": 18,
                    "is_fixed": 2,
                    "quality": 5,
                }
            }
        }, 1000)
        self.assertIsNone(status)

    def test_rtk_satellites_do_not_turn_quality_5_into_rtk_fixed(self):
        status = parse_dji_rtk_status({
            "data": {
                "position_state": {
                    "gps_number": 18,
                    "rtk_number": 24,
                    "is_fixed": 2,
                    "quality": 5,
                }
            }
        }, 1000)
        self.assertIsNotNone(status)
        self.assertFalse(status["is_fixed"])
        self.assertEqual(status["fix_state"], "fixed")

    def test_quality_10_and_fix_state_2_is_rtk_fixed(self):
        status = parse_dji_rtk_status({
            "data": {
                "position_state": {
                    "rtk_number": 24,
                    "is_fixed": 2,
                    "quality": 10,
                }
            }
        }, 1000)
        self.assertTrue(status["is_fixed"])

    def test_monitor_only_emits_transitions(self):
        monitor = RtkFixMonitor()
        self.assertIsNone(monitor.observe("A", {"is_fixed": False, "sampled_at_ms": 1}))
        event = monitor.observe("A", {"is_fixed": True, "sampled_at_ms": 2})
        self.assertEqual(event["type"], "acquired")
        self.assertIsNone(monitor.observe("A", {"is_fixed": True, "sampled_at_ms": 3}))


if __name__ == "__main__":
    unittest.main()
