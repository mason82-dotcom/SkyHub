import re
import unittest

from app.dji.map_contract import (
    DjiMapContractError,
    shared_group_id,
    validate_create_request,
    validate_update_request,
)
from app.dji.media_contract import (
    DjiMediaContractError,
    validate_fast_upload_request,
    validate_group_upload_callback,
    validate_tiny_fingerprint_request,
    validate_upload_callback_request,
)
from app.dji.storage_contract import exposed_sts_ttl


WORKSPACE = "e3dea0f5-37f2-4d79-ae58-490af3228069"
ELEMENT = "11111111-2222-4333-8444-555555555555"
GROUP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


def point_content():
    return {
        "type": "Feature",
        "properties": {"color": "#2D8CF0", "clampToGround": True},
        "geometry": {"type": "Point", "coordinates": [8.588, 49.218]},
    }


def media_ext():
    return {
        "drone_model_key": "0-77-2",
        "payload_model_key": "1-68-0",
        "tinny_fingerprint": "tiny-123",
        "sn": "AIRCRAFT123",
        "is_original": True,
    }


class DjiDemoContractTests(unittest.TestCase):
    def test_sts_ttl_keeps_reference_safety_margin(self):
        self.assertEqual(exposed_sts_ttl({}, 3600), 3300)

    def test_shared_map_group_is_stable_lowercase_uuid(self):
        first = shared_group_id(WORKSPACE)
        second = shared_group_id(WORKSPACE)
        self.assertEqual(first, second)
        self.assertRegex(
            first,
            re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
        )

    def test_valid_point_map_element(self):
        body = {
            "id": ELEMENT,
            "name": "Messpunkt",
            "resource": {
                "type": 0,
                "user_name": "pilot",
                "content": point_content(),
            },
        }
        self.assertIs(validate_create_request(body), body)

    def test_map_rejects_wrong_geometry_for_resource_type(self):
        body = {
            "id": ELEMENT,
            "name": "Linie",
            "resource": {
                "type": 1,
                "content": point_content(),
            },
        }
        with self.assertRaises(DjiMapContractError):
            validate_create_request(body)

    def test_map_update_requires_reference_shape(self):
        body = {"name": "Neu", "content": point_content()}
        self.assertIs(validate_update_request(body, 0), body)
        with self.assertRaises(DjiMapContractError):
            validate_update_request({"name": "Neu"}, 0)

    def test_media_fast_upload_contract(self):
        body = {
            "ext": media_ext(),
            "fingerprint": "ABCDEF123",
            "name": "DJI_TEST.JPG",
            "path": None,
        }
        self.assertIs(validate_fast_upload_request(body), body)

    def test_media_upload_callback_contract(self):
        ext = media_ext()
        ext["file_group_id"] = GROUP
        body = {
            "result": 0,
            "ext": ext,
            "fingerprint": "ABCDEF123",
            "name": "DJI_TEST.JPG",
            "path": None,
            "object_key": "media/DJI_TEST.JPG",
            "sub_file_type": 0,
            "metadata": {
                "absolute_altitude": 100.0,
                "relative_altitude": 20.0,
            },
        }
        self.assertIs(validate_upload_callback_request(body), body)

    def test_media_rejects_missing_fingerprint_instead_of_inventing_one(self):
        body = {"ext": media_ext(), "name": "DJI_TEST.JPG"}
        with self.assertRaises(DjiMediaContractError):
            validate_fast_upload_request(body)

    def test_tiny_fingerprint_contract(self):
        self.assertEqual(
            validate_tiny_fingerprint_request({"tiny_fingerprints": ["a", "b"]}),
            ["a", "b"],
        )
        with self.assertRaises(DjiMediaContractError):
            validate_tiny_fingerprint_request({"tiny_fingerprints": "a"})

    def test_group_upload_counts_are_consistent(self):
        body = {
            "file_group_id": GROUP,
            "file_count": 4,
            "file_uploaded_count": 3,
        }
        self.assertIs(validate_group_upload_callback(body), body)
        with self.assertRaises(DjiMediaContractError):
            validate_group_upload_callback({
                "file_group_id": GROUP,
                "file_count": 2,
                "file_uploaded_count": 3,
            })


if __name__ == "__main__":
    unittest.main()
