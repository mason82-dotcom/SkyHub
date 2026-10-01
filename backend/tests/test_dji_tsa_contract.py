import unittest

from app.dji.tsa_contract import (
    DjiTsaContractError,
    build_device_model,
    build_device_topology,
)


class DjiTsaContractTests(unittest.TestCase):
    def test_device_model_uses_dji_field_names_and_numeric_domain(self):
        model = build_device_model(0, 77, 2)
        self.assertEqual(model, {
            "device_model_key": "0-77-2",
            "domain": 0,
            "type": 77,
            "sub_type": 2,
        })
        self.assertIsInstance(model["domain"], int)

    def test_builds_required_topology_fields(self):
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
        self.assertEqual(node["device_model"]["device_model_key"], "0-77-2")
        self.assertEqual(
            set(node),
            {
                "sn",
                "device_callsign",
                "device_model",
                "online_status",
                "user_callsign",
                "icon_urls",
            },
        )

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
