import pathlib
import unittest

from app.dji.media_contract import DjiMediaContractError, validate_fast_upload_request
from app.dji.protocol import DjiProtocolValueError, validate_payload_index, validate_serial
from app.dji.storage_contract import (
    DjiStorageContractError,
    validate_workspace_object_key,
)
from app.routers.devices import track
from app.routers.media import list_media, upload_callback as media_upload_callback
from app.routers.wayline import (
    add_fav,
    duplicate_names,
    list_waylines,
    upload_callback as wayline_upload_callback,
)


WORKSPACE = "e3dea0f5-37f2-4d79-ae58-490af3228069"


def valid_media_callback(object_key: str) -> dict:
    return {
        "ext": {
            "drone_model_key": "0-77-2",
            "payload_model_key": "1-68-0",
            "tinny_fingerprint": "tiny",
            "sn": "AIRCRAFT123",
            "is_original": True,
            "file_group_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        },
        "fingerprint": "fingerprint",
        "name": "DJI_TEST.JPG",
        "path": None,
        "object_key": object_key,
        "sub_file_type": 0,
        "metadata": {},
    }


class SecurityBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_workspace_object_key_is_prefix_bound(self):
        self.assertEqual(
            validate_workspace_object_key(f"{WORKSPACE}/media/a.jpg", WORKSPACE),
            f"{WORKSPACE}/media/a.jpg",
        )
        for key in (
            "other-workspace/media/a.jpg",
            WORKSPACE,
            f"{WORKSPACE}2/media/a.jpg",
            "",
        ):
            with self.assertRaises(DjiStorageContractError):
                validate_workspace_object_key(key, WORKSPACE)

    def test_dji_identity_lengths_are_bounded(self):
        self.assertEqual(validate_serial("ABC123"), "ABC123")
        with self.assertRaises(DjiProtocolValueError):
            validate_serial("A" * 65)
        with self.assertRaises(DjiProtocolValueError):
            validate_payload_index("1" * 33)

    def test_media_contract_rejects_oversized_database_fields(self):
        body = {
            "ext": {
                "drone_model_key": "0-77-2",
                "payload_model_key": "1-68-0",
                "tinny_fingerprint": "tiny",
                "sn": "AIRCRAFT123",
                "is_original": True,
            },
            "fingerprint": "f",
            "name": "N" * 257,
            "path": None,
        }
        with self.assertRaises(DjiMediaContractError):
            validate_fast_upload_request(body)

    async def test_track_window_is_bounded_before_database_access(self):
        self.assertEqual((await track("ABC123", minutes=0, user="admin", s=None))["code"], 400)
        self.assertEqual((await track("ABC123", minutes=1441, user="admin", s=None))["code"], 400)

    async def test_media_list_limit_is_bounded_before_database_access(self):
        self.assertEqual((await list_media(limit=0, user="admin", s=None))["code"], 400)
        self.assertEqual((await list_media(limit=501, user="admin", s=None))["code"], 400)

    async def test_wayline_pagination_and_batch_sizes_are_bounded(self):
        self.assertEqual(
            (await list_waylines(WORKSPACE, page=0, page_size=10, user="admin", s=None))["code"],
            400,
        )
        self.assertEqual(
            (await list_waylines(WORKSPACE, page=1, page_size=101, user="admin", s=None))["code"],
            400,
        )
        self.assertEqual(
            (await duplicate_names(WORKSPACE, name=["x"] * 101, user="admin", s=None))["code"],
            400,
        )
        self.assertEqual(
            (await add_fav(WORKSPACE, id=["x"] * 101, user="admin", s=None))["code"],
            400,
        )

    async def test_media_callback_cannot_reference_other_workspace(self):
        response = await media_upload_callback(
            WORKSPACE,
            body=valid_media_callback("other-workspace/media/DJI_TEST.JPG"),
            user="admin",
            s=None,
        )
        self.assertEqual(response["code"], 400)

    async def test_wayline_callback_cannot_reference_other_workspace(self):
        response = await wayline_upload_callback(
            WORKSPACE,
            body={
                "name": "Route",
                "object_key": "other-workspace/wayline/route.kmz",
                "metadata": {
                    "drone_model_key": "0-77-2",
                    "payload_model_keys": ["1-68-0"],
                    "template_types": [1],
                },
            },
            user="admin",
            s=None,
        )
        self.assertEqual(response["code"], 400)


class StaticOutputSecurityTests(unittest.TestCase):
    def test_web_ui_escapes_dynamic_html_values(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1]
            / "app"
            / "static"
            / "index.html"
        ).read_text(encoding="utf-8")
        self.assertIn("function esc(v)", source)
        self.assertIn("function safeHttpUrl(v)", source)
        self.assertIn("esc(w.name)", source)
        self.assertIn("esc(m.name)", source)
        self.assertIn("esc(safeHttpUrl(m.url))", source)
        self.assertNotIn('"<div class=\'item\'><b>" + w.name', source)
        self.assertNotIn('" + m.url + "', source)

    def test_lifespan_awaits_cancelled_tasks(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1]
            / "app"
            / "main.py"
        ).read_text(encoding="utf-8")
        self.assertIn("await asyncio.gather(*tasks, return_exceptions=True)", source)


if __name__ == "__main__":
    unittest.main()
