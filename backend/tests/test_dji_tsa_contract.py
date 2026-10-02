import unittest

from app.dji.tsa_contract import (
    DjiTsaContractError,
    build_device_model,
    build_device_topology,
)


class DjiTsaContractTests(unittest.TestCase):
    def test_device_model_matches_current_dji_http_schema(self):
        model = build_device_model(0, 77, 2)
        self.assertEqual(model, {
            "key": "0-77-2",
            "domain": "0",
            "type": "77",
            "sub_type": "2",
        })
        for field in ("domain", "type", "sub_type"):
            self.assertIsInstance(model[field], str)
        self.assertNotIn("device_model_key", model)

    def test_builds_current_topology_fields(self):
        node = build_device_topology(
            sn="AIRCRAFT123",
            callsign=None,
            domain=0,
            type_=77,
            sub_type=2,
            online=True,
            fallback_callsign="Mavic 3M",
        )
        self.assertEqual(node["device_callsign"], "Mavic 3M")
        self.assertTrue(node["online_status"])
        self.assertEqual(node["device_model"]["key"], "0-77-2")
        self.assertEqual(node["user_id"], "")
        self.assertEqual(node["user_callsign"], "")
        self.assertEqual(
            set(node),
            {
                "sn",
                "device_callsign",
                "device_model",
                "online_status",
                "user_id",
                "user_callsign",
                "icon_urls",
            },
        )

    def test_optional_user_fields_remain_strings(self):
        node = build_device_topology(
            sn="RC123",
            callsign="RC",
            domain=2,
            type_=144,
            sub_type=0,
            online=True,
            fallback_callsign="DJI RC Pro Enterprise",
            user_id="user-1",
            user_callsign="Pilot",
        )
        self.assertEqual(node["user_id"], "user-1")
        self.assertEqual(node["user_callsign"], "Pilot")

    def test_rejects_non_reference_serial_shape(self):
        with self.assertRaises(DjiTsaContractError):
            build_device_topology(
                sn="BAD/SN",
                callsign="bad",
                domain=0,
                type_=77,
                sub_type=2,
                online=True,
                fallback_callsign="Mavic 3M",
            )


if __name__ == "__main__":
    unittest.main()
