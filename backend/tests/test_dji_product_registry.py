import unittest

from app.device_dict import (
    DEFAULT_CAMERA,
    EVIDENCE_ONLY_DEFAULT_CAMERA,
    EVIDENCE_ONLY_DEVICES,
    OFFICIAL_DEFAULT_CAMERA,
    OFFICIAL_DEVICES,
    describe,
    support_source,
)


class DjiProductRegistryTests(unittest.TestCase):
    def test_v1161_official_aircraft_enumerations(self):
        expected = {
            "0-60-0": "Matrice 300 RTK",
            "0-67-0": "Matrice 30",
            "0-67-1": "Matrice 30T",
            "0-77-0": "Mavic 3E",
            "0-77-1": "Mavic 3T",
            "0-77-3": "Mavic 3TA",
            "0-89-0": "Matrice 350 RTK",
            "0-91-0": "Matrice 3D",
            "0-91-1": "Matrice 3TD",
            "0-99-0": "Matrice 4E",
            "0-99-1": "Matrice 4T",
            "0-100-0": "Matrice 4D",
            "0-100-1": "Matrice 4TD",
            "0-103-0": "Matrice 400",
        }
        for key, name in expected.items():
            self.assertEqual(OFFICIAL_DEVICES[key], (name, "aircraft"))
            self.assertEqual(support_source(key), "dji-cloud-api-v1.16.1")

    def test_v1161_official_gateway_enumerations(self):
        expected = {
            "2-56-0": ("DJI Smart Controller Enterprise", "rc"),
            "2-119-0": ("DJI RC Plus", "rc"),
            "2-144-0": ("DJI RC Pro Enterprise", "rc"),
            "2-174-0": ("DJI RC Plus 2", "rc"),
            "3-1-0": ("DJI Dock", "dock"),
            "3-2-0": ("DJI Dock 2", "dock"),
            "3-3-0": ("DJI Dock 3", "dock"),
        }
        for key, identity in expected.items():
            self.assertEqual(OFFICIAL_DEVICES[key], identity)

    def test_m3m_remains_evidence_only(self):
        self.assertNotIn("0-77-2", OFFICIAL_DEVICES)
        self.assertEqual(EVIDENCE_ONLY_DEVICES["0-77-2"], ("Mavic 3M", "aircraft"))
        self.assertEqual(support_source("0-77-2"), "fh-clone-real-hardware")
        self.assertEqual(EVIDENCE_ONLY_DEFAULT_CAMERA["0-77-2"], "68-0-0")

    def test_official_integrated_camera_payloads(self):
        expected = {
            "0-67-0": "52-0-0",
            "0-67-1": "53-0-0",
            "0-77-0": "66-0-0",
            "0-77-1": "67-0-0",
            "0-77-3": "129-0-0",
            "0-91-0": "80-0-0",
            "0-91-1": "81-0-0",
            "0-99-0": "88-0-0",
            "0-99-1": "89-0-0",
            "0-100-0": "98-0-0",
            "0-100-1": "99-0-0",
        }
        self.assertEqual(OFFICIAL_DEFAULT_CAMERA, expected)
        for key, payload in expected.items():
            self.assertEqual(DEFAULT_CAMERA[key], payload)

    def test_interchangeable_payload_aircraft_have_no_guessed_default_camera(self):
        for key in ("0-60-0", "0-89-0", "0-103-0"):
            self.assertNotIn(key, DEFAULT_CAMERA)

    def test_unknown_domain_three_is_still_classified_as_dock(self):
        self.assertEqual(describe("3-999-0")[1], "dock")
        self.assertEqual(support_source("3-999-0"), "unknown")


if __name__ == "__main__":
    unittest.main()
