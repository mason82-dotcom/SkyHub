import unittest

from app.config import RuntimeConfigError, Settings, validate_runtime_settings


def valid_settings(**overrides):
    values = {
        "workspace_id": "e3dea0f5-37f2-4d79-ae58-490af3228069",
        "public_host": "192.168.178.30",
        "dji_app_id": "app-id",
        "dji_app_key": "app-key",
        "dji_app_license": "app-license",
        "admin_user": "admin",
        "admin_password": "AdminPassword123",
        "jwt_secret": "J" * 48,
        "mqtt_backend_user": "backend",
        "mqtt_backend_password": "BackendPassword123",
        "mqtt_pilot_user": "pilot",
        "mqtt_pilot_password": "PilotPassword123",
        "minio_sts_user": "pilot-uploader",
        "minio_sts_password": "StoragePassword123",
        "minio_bucket": "skyhub",
    }
    values.update(overrides)
    return Settings(**values)


class RuntimeConfigTests(unittest.TestCase):
    def test_valid_runtime_settings_pass(self):
        validate_runtime_settings(valid_settings())

    def test_placeholder_secrets_fail_closed(self):
        with self.assertRaises(RuntimeConfigError) as ctx:
            validate_runtime_settings(valid_settings(
                admin_password="change-me",
                jwt_secret="bitte-langen-zufallswert-setzen",
            ))
        message = str(ctx.exception)
        self.assertIn("ADMIN_PASSWORD", message)
        self.assertIn("JWT_SECRET", message)
        self.assertNotIn("AdminPassword123", message)

    def test_missing_dji_credentials_are_rejected(self):
        with self.assertRaises(RuntimeConfigError) as ctx:
            validate_runtime_settings(valid_settings(dji_app_license=""))
        self.assertIn("DJI_APP_LICENSE", str(ctx.exception))

    def test_workspace_must_be_canonical_uuid(self):
        with self.assertRaises(RuntimeConfigError):
            validate_runtime_settings(valid_settings(
                workspace_id="E3DEA0F5-37F2-4D79-AE58-490AF3228069"
            ))
        with self.assertRaises(RuntimeConfigError):
            validate_runtime_settings(valid_settings(workspace_id="not-a-uuid"))

    def test_public_host_must_not_include_scheme(self):
        with self.assertRaises(RuntimeConfigError) as ctx:
            validate_runtime_settings(valid_settings(public_host="http://192.168.178.30"))
        self.assertIn("PUBLIC_HOST", str(ctx.exception))

    def test_mqtt_roles_must_be_distinct(self):
        with self.assertRaises(RuntimeConfigError) as ctx:
            validate_runtime_settings(valid_settings(
                mqtt_backend_user="same",
                mqtt_pilot_user="same",
            ))
        self.assertIn("muessen verschieden sein", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
