from fastapi import APIRouter, Depends

from ..common import fail, ok
from ..config import settings
from ..dji.storage_contract import STS_DURATION_SECONDS, build_sts_response
from ..s3util import assume_role
from .auth import require_user

router = APIRouter()
P = "/storage/api/v1/workspaces/{workspace_id}"


@router.post(P + "/sts")
def get_sts(workspace_id: str, user: str = Depends(require_user)):
    """Temporaere MinIO-Zugangsdaten, mit denen Pilot 2 Medien/KMZ direkt hochlaedt."""
    try:
        c = assume_role(STS_DURATION_SECONDS)
    except Exception as e:
        return fail(500, f"STS fehlgeschlagen: {e}")
    return ok(build_sts_response(
        c,
        bucket=settings.minio_bucket,
        endpoint=settings.minio_public_endpoint,
        object_key_prefix=workspace_id,
        provider="minio",
        region="us-east-1",
    ))
