import unittest

from app.dji.protocol import DJI_CLOUD_API_VERSION
from app.main import healthz


class HealthEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_reports_protocol_baseline(self):
        response = await healthz()
        self.assertEqual(response["status"], "ok")
        self.assertEqual(
            response["dji_cloud_api_version"],
            DJI_CLOUD_API_VERSION,
        )


if __name__ == "__main__":
    unittest.main()
