import unittest

from app.dji.topology import parse_dji_topology_update, to_public_dji_topology_payload


class DjiTopologyTests(unittest.TestCase):
    def test_parses_real_m3m_identity_shape(self):
        parsed = parse_dji_topology_update("RC-PRO", {
            "method": "update_topo",
            "data": {
                "domain": 2,
                "type": 144,
                "sub_type": 0,
                "sub_devices": [{
                    "sn": "M3M",
                    "domain": 0,
                    "type": 77,
                    "sub_type": 2,
                    "index": "A",
                }],
            },
        }, 1234)
        self.assertEqual(parsed["product"]["type"], 144)
        self.assertEqual(parsed["sub_devices"][0]["product"]["sub_type"], 2)

    def test_rejects_incomplete_gateway_identity(self):
        self.assertIsNone(parse_dji_topology_update("RC-PRO", {
            "method": "update_topo",
            "data": {"domain": 2, "type": 144, "sub_devices": []},
        }))

    def test_skips_subdevice_with_string_subtype(self):
        parsed = parse_dji_topology_update("RC-PRO", {
            "method": "update_topo",
            "data": {
                "domain": 2,
                "type": 144,
                "sub_type": 0,
                "sub_devices": [
                    {"sn": "BAD", "domain": 0, "type": 77, "sub_type": "2"},
                    {"sn": "GOOD", "domain": 0, "type": 77, "sub_type": 2},
                ],
            },
        })
        self.assertEqual([d["sn"] for d in parsed["sub_devices"]], ["GOOD"])

    def test_public_payload_drops_secrets(self):
        parsed = parse_dji_topology_update("RC-PRO", {
            "method": "update_topo",
            "data": {
                "domain": 2,
                "type": 144,
                "sub_type": 0,
                "device_secret": "secret",
                "sub_devices": [{
                    "sn": "M3M",
                    "domain": 0,
                    "type": 77,
                    "sub_type": 2,
                    "nonce": "secret-2",
                }],
            },
        })
        public = str(to_public_dji_topology_payload(parsed))
        self.assertNotIn("secret", public)
        self.assertIn("M3M", public)


if __name__ == "__main__":
    unittest.main()
