from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.config import settings
from app.dji.map_contract import (
    DjiMapContractError,
    shared_group_id,
    validate_create_request,
    validate_identifier,
    validate_update_request,
)
from app.routers.map import delete_element, update_element


class DjiMapV1161Tests(unittest.IsolatedAsyncioTestCase):
    def test_element_id_is_documented_string_not_forced_uuid(self):
        self.assertEqual(validate_identifier("pilot-element-1"), "pilot-element-1")
        with self.assertRaises(DjiMapContractError):
            validate_identifier("")

    def test_create_requires_id_name_resource_only(self):
        body = {
            "id": "pilot-element-1",
            "name": "Marker",
            "resource": {},
        }
        self.assertIs(validate_create_request(body), body)

    def test_update_fields_are_optional(self):
        empty = {}
        self.assertIs(validate_update_request(empty, None), empty)
        with_name = {"name": "Neu"}
        self.assertIs(validate_update_request(with_name, None), with_name)

    async def test_update_returns_element_id(self):
        group_id = shared_group_id(settings.workspace_id)
        now = datetime.now(timezone.utc)
        element = SimpleNamespace(
            id="pilot-element-1",
            group_id=group_id,
            name="Alt",
            resource={},
            created=now,
            updated=now,
        )
        session = Mock()
        session.get = AsyncMock(return_value=element)
        session.commit = AsyncMock()

        with patch("app.routers.map.hub.broadcast", new=AsyncMock()):
            response = await update_element(
                settings.workspace_id,
                element.id,
                {"name": "Neu"},
                user="admin",
                s=session,
            )

        self.assertEqual(response["data"], {"id": element.id})
        self.assertEqual(element.name, "Neu")
        session.commit.assert_awaited_once()

    async def test_delete_returns_element_id(self):
        group_id = shared_group_id(settings.workspace_id)
        now = datetime.now(timezone.utc)
        element = SimpleNamespace(
            id="pilot-element-1",
            group_id=group_id,
            name="Marker",
            resource={},
            created=now,
            updated=now,
        )
        session = Mock()
        session.get = AsyncMock(return_value=element)
        session.delete = AsyncMock()
        session.commit = AsyncMock()

        with patch("app.routers.map.hub.broadcast", new=AsyncMock()):
            response = await delete_element(
                settings.workspace_id,
                element.id,
                user="admin",
                s=session,
            )

        self.assertEqual(response["data"], {"id": element.id})
        session.delete.assert_awaited_once()
        session.commit.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
