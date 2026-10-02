import unittest

from app.dji.wayline_contract import (
    DjiWaylineContractError,
    fallback_wayline_name,
    filter_wayline_items,
    validate_list_query,
    validate_upload_callback,
)


ITEMS = [
    {
        "id": "a",
        "name": "Bravo",
        "drone_model_key": "0-77-0",
        "payload_model_keys": ["1-66-0"],
        "template_types": [0],
        "favorited": False,
        "action_type": 0,
        "update_time": 200,
    },
    {
        "id": "b",
        "name": "Alpha",
        "drone_model_key": "0-99-1",
        "payload_model_keys": ["1-89-0"],
        "template_types": [1],
        "favorited": True,
        "action_type": 0,
        "update_time": 300,
    },
]


class DjiWaylineContractTests(unittest.TestCase):
    def test_v1161_list_query_accepts_documented_filters(self):
        order = validate_list_query(
            page=1,
            page_size=20,
            order_by="update_time desc",
            template_type=[0],
            action_type=0,
            drone_model_keys=["0-77-0"],
            payload_model_key=["1-66-0"],
        )
        self.assertEqual(order, "update_time desc")

    def test_list_query_rejects_unknown_order_and_bad_product_key(self):
        with self.assertRaises(DjiWaylineContractError):
            validate_list_query(
                page=1,
                page_size=10,
                order_by="object_key desc",
                template_type=[],
                action_type=None,
                drone_model_keys=[],
                payload_model_key=[],
            )
        with self.assertRaises(DjiWaylineContractError):
            validate_list_query(
                page=1,
                page_size=10,
                order_by=None,
                template_type=[],
                action_type=None,
                drone_model_keys=["M3E"],
                payload_model_key=[],
            )

    def test_filters_and_sorts_waylines(self):
        result = filter_wayline_items(
            ITEMS,
            favorited=None,
            template_type=[0],
            action_type=0,
            drone_model_keys=["0-77-0"],
            payload_model_key=["1-66-0"],
            order_by="name asc",
        )
        self.assertEqual([item["id"] for item in result], ["a"])

        all_sorted = filter_wayline_items(
            ITEMS,
            favorited=None,
            template_type=[],
            action_type=None,
            drone_model_keys=[],
            payload_model_key=[],
            order_by="update_time desc",
        )
        self.assertEqual([item["id"] for item in all_sorted], ["b", "a"])

    def test_ai_spot_check_filter_returns_no_normal_waylines(self):
        result = filter_wayline_items(
            ITEMS,
            favorited=None,
            template_type=[],
            action_type=1,
            drone_model_keys=[],
            payload_model_key=[],
            order_by="update_time desc",
        )
        self.assertEqual(result, [])

    def test_upload_callback_requires_object_key_but_name_is_optional(self):
        parsed = validate_upload_callback({
            "object_key": "workspace/wayline/mission.kmz",
            "metadata": {
                "drone_model_key": "0-77-0",
                "payload_model_keys": ["1-66-0"],
                "template_types": [0],
            },
        })
        self.assertIsNone(parsed["name"])
        self.assertEqual(parsed["object_key"], "workspace/wayline/mission.kmz")

        with self.assertRaises(DjiWaylineContractError):
            validate_upload_callback({"name": "Mission"})

    def test_fallback_name_comes_from_object_key(self):
        self.assertEqual(
            fallback_wayline_name("workspace/wayline/mission.kmz"),
            "mission",
        )
        self.assertEqual(fallback_wayline_name("workspace/wayline/.kmz"), "Route")


if __name__ == "__main__":
    unittest.main()
