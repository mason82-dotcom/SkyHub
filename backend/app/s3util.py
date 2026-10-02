import boto3
from botocore.config import Config

from .config import settings

_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"})


def _client(service: str, endpoint: str):
    return boto3.client(service, endpoint_url=endpoint, region_name="us-east-1",
                        aws_access_key_id=settings.minio_sts_user,
                        aws_secret_access_key=settings.minio_sts_password,
                        config=_cfg)


def internal_s3():
    return _client("s3", settings.minio_internal_endpoint)


def presign_get(object_key: str, expires: int = 3600) -> str:
    # Signatur mit oeffentlichem Host, sonst passt der Host-Header nicht
    return _client("s3", settings.minio_public_endpoint).generate_presigned_url(
        "get_object", Params={"Bucket": settings.minio_bucket, "Key": object_key}, ExpiresIn=expires)


def assume_role(duration: int = 3600) -> dict:
    sts = _client("sts", settings.minio_internal_endpoint)
    return sts.assume_role(RoleArn="arn:minio:iam:::role/skyhub", RoleSessionName="pilot",
                           DurationSeconds=duration)["Credentials"]
