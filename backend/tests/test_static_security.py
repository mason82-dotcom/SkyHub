import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
PILOT = ROOT / "app" / "static" / "pilot.html"
INDEX = ROOT / "app" / "static" / "index.html"


class StaticSecurityContractTests(unittest.TestCase):
    def test_pilot_uses_authenticated_dji_credentials(self):
        source = PILOT.read_text(encoding="utf-8")
        self.assertIn(
            'call("platformVerifyLicense", d.app_id, d.app_key, d.app_license)',
            source,
        )
        self.assertNotIn("cfg.app_id", source)
        self.assertNotIn("cfg.app_key", source)
        self.assertNotIn("cfg.app_license", source)

    def test_pilot_ws_uses_ws_ticket_not_access_token(self):
        source = PILOT.read_text(encoding="utf-8")
        self.assertIn('load("ws", { host: d.ws_host, token: d.ws_token })', source)
        self.assertNotIn('load("ws", { host: d.ws_host, token: d.access_token })', source)

    def test_browser_refreshes_ws_ticket_for_reconnects(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertIn('/api/v1/ws-ticket', source)
        self.assertIn("ticket.data.ws_token", source)
        self.assertNotIn('/api/v1/ws?x-auth-token=" + token', source)

    def test_browser_uses_authenticated_workspace_id(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertNotIn("/workspaces/x/", source)
        self.assertIn("workspaceId = j.data.workspace_id", source)
        self.assertIn('"/wayline/api/v1/workspaces/" + encodeURIComponent(workspaceId)', source)


if __name__ == "__main__":
    unittest.main()
