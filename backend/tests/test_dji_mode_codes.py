import unittest

from app.device_dict import MODE_CODES, MODE_CODE_REASONS
from app.dji.normalizer import normalize_dji_payload


class DjiModeCodeTests(unittest.TestCase):
    def test_v1161_mode_codes_cover_zero_through_eighteen(self):
        self.assertEqual(set(MODE_CODES), set(range(19)))
        self.assertEqual(MODE_CODES[12], "Three-blade landing")
        self.assertEqual(MODE_CODES[15], "APAS")
        self.assertEqual(MODE_CODES[17], "Live Flight Controls")
        self.assertEqual(MODE_CODES[18], "Airborne RTK fixing")

    def test_v1161_mode_reason_codes_cover_zero_through_twenty_two(self):
        self.assertEqual(set(MODE_CODE_REASONS), set(range(23)))
        self.assertIn("Akkustand", MODE_CODE_REASONS[1])
        self.assertIn("Rueckkehr abgebrochen", MODE_CODE_REASONS[21])

    def test_normalizer_preserves_mode_reason_code(self):
        normalized = normalize_dji_payload({
            "data": {
                "mode_code": 9,
                "mode_code_reason": 6,
                "latitude": 49.1,
                "longitude": 8.5,
            }
        })
        self.assertEqual(normalized["flight"]["mode"]["code"], 9)
        self.assertEqual(normalized["flight"]["mode"]["reason_code"], 6)


if __name__ == "__main__":
    unittest.main()
