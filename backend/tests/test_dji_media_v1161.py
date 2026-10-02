import unittest
from unittest.mock import AsyncMock, Mock

from app.config import settings
from app.dji.media_contract import (
    DjiMediaContractError,
    media_storage_identity,
    validate_fast_upload_request,
    validate_group_upload_callback,
    validate_tiny_fingerprint_request,
    validate_upload_callback_request,
)
from app.routers.media import upload_callback


class DjiMediaV1161Tests(unittest.IsolatedAsyncioTestCase):
    def test_fast_upload_requires_only_fingerprint(self):
        body = {"fingerprint": "ABCDEF123"}
        self.assertIs(validate_fast_upload_request(body), body)

    def test_tiny_fingerprint_accepts_current_array_body_and_legacy_object(self):
        self.assertEqual(
            validate_tiny_fingerprint_request(["tiny-a", "tiny-b"]),
            ["tiny-a", "tiny-b"],
        )
        self.assertEqual(
            validate_tiny_fingerprint_request(
                {"tiny_fingerprints": ["tiny-a", "tiny-b"]}
            ),
            ["tiny-a", "tiny-b"],
        )

    def test_minimal_upload_callback_matches_current_dji_contract(self):
        body = {
            "result": 0,
            "name": "DJI_TEST.JPG",
            "object_key": f"{settings.workspace_id}/media/DJI_TEST.JPG",
        }
        parsed = validate_upload_callback_request(body)
        self.assertEqual(parsed["ext"], {})
        self.assertIsNone(parsed["fingerprint"])
        self.assertEqual(parsed["metadata"], {})

        internal = media_storage_identity(parsed)
        self.assertTrue(internal.startswith("object-key:"))
        self.assertNotEqual(internal, parsed["object_key"])

    def test_real_fingerprint_is_preserved_for_fast_upload_matching(self):
        parsed = validate_upload_callback_request({
            "result": 0,
            "name": "DJI_TEST.JPG",
            "object_key": f"{settings.workspace_id}/media/DJI_TEST.JPG",
            "fingerprint": "REAL-FINGERPRINT",
        })
        self.assertEqual(media_storage_identity(parsed), "REAL-FINGERPRINT")

    def test_upload_callback_requires_result_name_and_object_key(self):
        for body in (
            {"name": "x.jpg", "object_key": "x"},
            {"result": 0, "object_key": "x"},
            {"result": 0, "name": "x.jpg"},
        ):
            with self.assertRaises(DjiMediaContractError):
                validate_upload_callback_request(body)

    def test_group_callback_allows_omitted_optional_group_id(self):
        body = {"file_count": 4, "file_uploaded_count": 3}
        self.assertIs(validate_group_upload_callback(body), body)

    async def test_router_returns_object_key_object_and_persists_minimal_success(self):
        object_key = f"{settings.workspace_id}/media/DJI_TEST.JPG"
        session = Mock()
        session.scalar = AsyncMock(return_value=None)
        session.commit = AsyncMock()
        session.add = Mock()

        response = await upload_callback(
            settings.workspace_id,
            {
                "result": 0,
                "name": "DJI_TEST.JPG",
                "object_key": object_key,
            },
            user="admin",
            s=session,
        )
        self.assertEqual(response["code"], 0)
        self.assertEqual(response["data"], {"object_key": object_key})
        session.add.assert_called_once()
        session.commit.assert_awaited_once()

    async def test_router_acknowledges_failed_upload_without_persisting(self):
        object_key = f"{settings.workspace_id}/media/FAILED.JPG"
        session = Mock()
        session.scalar = AsyncMock()
        session.commit = AsyncMock()
        session.add = Mock()

        response = await upload_callback(
            settings.workspace_id,
            {
                "result": 7,
                "name": "FAILED.JPG",
                "object_key": object_key,
            },
            user="admin",
            s=session,
        )
        self.assertEqual(response["code"], 0)
        self.assertEqual(response["data"], {"object_key": object_key})
        session.add.assert_not_called()
        session.commit.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
