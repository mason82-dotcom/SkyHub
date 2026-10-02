import unittest

from fastapi import HTTPException

from app.config import settings
from app.routers.auth import (
    LoginReq,
    decode_token,
    login,
    make_access_token,
    make_ws_token,
    pilot_config,
    require_workspace_user,
    ws_ticket,
)


class AuthSecurityTests(unittest.IsolatedAsyncioTestCase):
    def test_access_and_ws_tokens_are_not_interchangeable(self):
        access = make_access_token("admin")
        ws = make_ws_token("admin")

        self.assertEqual(decode_token(access, "access")["sub"], "admin")
        self.assertEqual(decode_token(ws, "ws")["sub"], "admin")

        with self.assertRaises(HTTPException) as ctx:
            decode_token(access, "ws")
        self.assertEqual(ctx.exception.status_code, 401)

        with self.assertRaises(HTTPException) as ctx:
            decode_token(ws, "access")
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_workspace_dependency_accepts_only_configured_workspace(self):
        access = make_access_token("admin")
        user = await require_workspace_user(settings.workspace_id, x_auth_token=access)
        self.assertEqual(user, "admin")

        with self.assertRaises(HTTPException) as ctx:
            await require_workspace_user(
                "00000000-0000-4000-8000-000000000000",
                x_auth_token=access,
            )
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_public_pilot_config_contains_no_dji_credentials(self):
        response = await pilot_config()
        self.assertEqual(response["code"], 0)
        data = response["data"]
        self.assertNotIn("app_id", data)
        self.assertNotIn("app_key", data)
        self.assertNotIn("app_license", data)
        self.assertEqual(data["workspace_id"], settings.workspace_id)

    async def test_login_releases_credentials_only_after_authentication(self):
        response = await login(LoginReq(
            username=settings.admin_user,
            password=settings.admin_password,
        ))
        self.assertEqual(response["code"], 0)
        data = response["data"]
        self.assertIn("access_token", data)
        self.assertIn("ws_token", data)
        self.assertIn("app_id", data)
        self.assertIn("app_key", data)
        self.assertIn("app_license", data)
        self.assertEqual(decode_token(data["access_token"], "access")["ws"], settings.workspace_id)
        self.assertEqual(decode_token(data["ws_token"], "ws")["ws"], settings.workspace_id)

    async def test_ws_ticket_is_ws_only(self):
        response = await ws_ticket("admin")
        token = response["data"]["ws_token"]
        self.assertEqual(decode_token(token, "ws")["sub"], "admin")
        with self.assertRaises(HTTPException):
            decode_token(token, "access")


if __name__ == "__main__":
    unittest.main()
