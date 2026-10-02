import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "docker-compose.yml"
DOCKERFILE = ROOT / "minio" / "Dockerfile"
INIT = ROOT / "scripts" / "minio-init.sh"


class MinioSourceBuildTests(unittest.TestCase):
    def test_compose_uses_local_minio_image(self):
        compose = COMPOSE.read_text(encoding="utf-8")
        self.assertIn("context: ./minio", compose)
        self.assertIn("image: skyhub-minio:RELEASE.2024-12-18T13-15-44Z", compose)
        self.assertNotIn("image: minio/minio:", compose)
        self.assertNotIn("image: quay.io/minio/minio:", compose)
        self.assertNotIn("image: minio/mc:", compose)
        self.assertNotIn("image: quay.io/minio/mc:", compose)
        self.assertIn("pull_policy: never", compose)

    def test_source_build_pins_server_and_client_versions(self):
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertIn(
            "ARG MINIO_VERSION=RELEASE.2024-12-18T13-15-44Z",
            dockerfile,
        )
        self.assertIn(
            "ARG MC_VERSION=RELEASE.2024-11-21T17-21-54Z",
            dockerfile,
        )
        self.assertIn('github.com/minio/minio@${MINIO_VERSION}', dockerfile)
        self.assertIn('github.com/minio/mc@${MC_VERSION}', dockerfile)
        self.assertIn("CGO_ENABLED=0", dockerfile)

    def test_runtime_contains_both_minio_and_mc(self):
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertIn("COPY --from=build /out/minio /usr/local/bin/minio", dockerfile)
        self.assertIn("COPY --from=build /out/mc /usr/local/bin/mc", dockerfile)

    def test_bucket_init_uses_one_idempotent_flag_form(self):
        source = INIT.read_text(encoding="utf-8")
        self.assertIn('mc mb --ignore-existing "local/$MINIO_BUCKET"', source)
        self.assertNotIn("--ignore-existing -p", source)


if __name__ == "__main__":
    unittest.main()
