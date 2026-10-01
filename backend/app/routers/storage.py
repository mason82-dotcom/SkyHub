from fastapi import APIRouter, Depends

from ..common import fail, ok
from ..config import settings
from ..s3util import assume_role
from .auth import require_user

router = APIRouter()
P = "/storage/api/v1/workspaces/{workspace_id}"


@router.api_route(P + "/sts", methods=["GET", "POST"])
def get_sts(workspace_id: str, user: str = Depends(require_user)):
    """Temporaere MinIO-Zugangsdaten, mit denen Pilot 2 Medien/KMZ direkt hochlaedt."""
    try:
        c = assume_role(3600)
    except Exception as e:
        return fail(500, f"STS fehlgeschlagen: {e}")
    return ok({
        "bucket": settings.minio_bucket,
        "credentials": {"access_key_id": c["AccessKeyId"],
                        "access_key_secret": c["SecretAccessKey"],
                        "security_token": c["SessionToken"], "expire": 3600},
        "endpoint": settings.minio_public_endpoint,
        "object_key_prefix": workspace_id,
        "provider": "minio",
        "region": "us-east-1",
    })
