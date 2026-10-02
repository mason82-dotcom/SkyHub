import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
CONF = ROOT / "mosquitto" / "config" / "mosquitto.conf"
ACL_TEMPLATE = ROOT / "mosquitto" / "config" / "acl.template"
INIT = ROOT / "scripts" / "init.sh"


class MqttAclContractTests(unittest.TestCase):
    def test_broker_requires_password_and_acl_files(self):
        source = CONF.read_text(encoding="utf-8")
        self.assertIn("allow_anonymous false", source)
        self.assertIn("password_file /mosquitto/config/passwd", source)
        self.assertIn("acl_file /mosquitto/config/acl", source)

    def test_backend_has_only_required_topic_directions(self):
        source = ACL_TEMPLATE.read_text(encoding="utf-8")
        required = {
            "topic read sys/product/+/status",
            "topic read thing/product/+/osd",
            "topic read thing/product/+/state",
            "topic read thing/product/+/events",
            "topic read thing/product/+/requests",
            "topic read thing/product/+/services_reply",
            "topic write sys/product/+/status_reply",
            "topic write thing/product/+/events_reply",
            "topic write thing/product/+/requests_reply",
            "topic write thing/product/+/services",
        }
        backend = source.split("user __BACKEND_USER__", 1)[1].split("user __PILOT_USER__", 1)[0]
        for rule in required:
            self.assertIn(rule, backend)
        self.assertNotIn("topic readwrite", backend)
        self.assertNotIn("topic read #", backend)
        self.assertNotIn("topic write #", backend)

    def test_pilot_permissions_are_inverse_of_current_bridge_flow(self):
        source = ACL_TEMPLATE.read_text(encoding="utf-8")
        pilot = source.split("user __PILOT_USER__", 1)[1]
        for rule in (
            "topic write sys/product/+/status",
            "topic write thing/product/+/osd",
            "topic write thing/product/+/state",
            "topic write thing/product/+/events",
            "topic write thing/product/+/requests",
            "topic write thing/product/+/services_reply",
            "topic read sys/product/+/status_reply",
            "topic read thing/product/+/events_reply",
            "topic read thing/product/+/requests_reply",
            "topic read thing/product/+/services",
        ):
            self.assertIn(rule, pilot)
        self.assertNotIn("topic readwrite", pilot)

    def test_init_validates_distinct_mqtt_users_and_generates_acl(self):
        source = INIT.read_text(encoding="utf-8")
        self.assertIn('MQTT_BACKEND_USER" != "$MQTT_PILOT_USER', source)
        self.assertIn("--env-file .env", source)
        self.assertIn("/mosquitto/config/acl.template > /mosquitto/config/acl.tmp", source)
        self.assertIn("mv /mosquitto/config/acl.tmp /mosquitto/config/acl", source)
        self.assertNotIn(". ./.env", source)
        self.assertNotIn("source .env", source)


if __name__ == "__main__":
    unittest.main()
