import unittest
from unittest.mock import AsyncMock, patch

from app.dji.config_contract import (
    DjiConfigContractError,
    build_product_config,
    validate_config_request,
)
from app.dji.storage_contract import (
    DjiStorageContractError,
    build_sts_response,
    validate_storage_config_request,
)
from app.mqtt_bridge import MqttBridge


class DjiRequestContractTests(unittest.IsolatedAsyncioTestCase):
    def test_config_contract_requires_documented_scope_and_type(self):
        data = {"config_type": "json", "config_scope": "product"}
        self.assertIs(validate_config_request(data), data)
        with self.assertRaises(DjiConfigContractError):
            validate_config_request({"config_type": "xml", "config_scope": "product"})

    def test_product_config_has_direct_documented_fields(self):
        result = build_product_config(
            ntp_server_host="pool.ntp.org",
            ntp_server_port=123,
            app_id="app",
            app_key="key",
            app_license="license",
        )
        self.assertEqual(result["ntp_server_port"], 123)
        self.assertNotIn("result", result)
        self.assertNotIn("output", result)

    def test_storage_request_only_enables_media_module(self):
        self.assertEqual(validate_storage_config_request({"module": 0}), {"module": 0})
        with self.assertRaises(DjiStorageContractError):
            validate_storage_config_request({"module": 1})

    def test_build_sts_response_uses_mqtt_http_contract_shape(self):
        result = build_sts_response(
            {
                "AccessKeyId": "access",
                "SecretAccessKey": "secret",
                "SessionToken": "token",
            },
            bucket="skyhub",
            endpoint="http://minio.example:9000",
            object_key_prefix="workspace",
        )
        self.assertEqual(result["credentials"]["expire"], 3300)
        self.assertEqual(result["provider"], "minio")
        self.assertEqual(result["object_key_prefix"], "workspace")

    async def test_config_mqtt_reply_has_no_storage_wrapper(self):
        bridge = MqttBridge()
        bridge.publish = AsyncMock()
        await bridge.on_request("RC123", {
            "method": "config",
            "tid": "tid-1",
            "bid": "bid-1",
            "data": {"config_type": "json", "config_scope": "product"},
        })
        topic, payload = bridge.publish.await_args.args
        self.assertEqual(topic, "thing/product/RC123/requests_reply")
        self.assertEqual(payload["method"], "config")
        self.assertIn("app_id", payload["data"])
        self.assertIn("app_key", payload["data"])
        self.assertIn("app_license", payload["data"])
        self.assertNotIn("result", payload["data"])
        self.assertNotIn("output", payload["data"])

    async def test_storage_config_get_mqtt_reply_is_wrapped(self):
        bridge = MqttBridge()
        bridge.publish = AsyncMock()
        credentials = {
            "AccessKeyId": "access",
            "SecretAccessKey": "secret",
            "SessionToken": "token",
        }
        with patch("app.mqtt_bridge.assume_role", return_value=credentials):
            await bridge.on_request("RC123", {
                "method": "storage_config_get",
                "tid": "tid-2",
                "bid": "bid-2",
                "data": {"module": 0},
            })
        topic, payload = bridge.publish.await_args.args
        self.assertEqual(topic, "thing/product/RC123/requests_reply")
        self.assertEqual(payload["method"], "storage_config_get")
        self.assertEqual(payload["data"]["result"], 0)
        self.assertEqual(payload["data"]["output"]["provider"], "minio")

    async def test_unknown_request_method_fails_closed(self):
        bridge = MqttBridge()
        bridge.publish = AsyncMock()
        await bridge.on_request("RC123", {
            "method": "unknown_method",
            "tid": "tid-3",
            "bid": "bid-3",
            "data": {},
        })
        _, payload = bridge.publish.await_args.args
        self.assertEqual(payload["data"]["result"], -1)


if __name__ == "__main__":
    unittest.main()
