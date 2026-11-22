from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import SettingsDep
from app.core.exceptions import AppError
from app.modules.analytics.schemas import (
    RelationshipRequest,
    RelationshipResponse,
    SkippedEntries,
)
from app.modules.analytics.service import accounts_from_inputs, compute_relationships

router = APIRouter(prefix="/analytics", tags=["analytics"])


class TooManyAccountsError(AppError):
    status_code = 422
    code = "too_many_accounts"


@router.post(
    "/relationships",
    summary="Compute follower/following relationship analytics",
    responses={
        413: {"description": "Request body too large."},
        422: {"description": "Validation failed or too many accounts."},
    },
)
def relationships(body: RelationshipRequest, settings: SettingsDep) -> RelationshipResponse:
    """Stateless computation over account lists already extracted by the client.

    Nothing in the request is stored or logged. The raw Instagram export (ZIP) is never accepted
    by this API; it is parsed client-side.
    """
    limit = settings.max_accounts_per_list
    if len(body.followers) > limit or len(body.following) > limit:
        raise TooManyAccountsError(f"Each list may contain at most {limit} accounts.")

    followers, skipped_followers = accounts_from_inputs(body.followers)
    following, skipped_following = accounts_from_inputs(body.following)
    return RelationshipResponse(
        analytics=compute_relationships(followers, following),
        skipped_invalid=SkippedEntries(followers=skipped_followers, following=skipped_following),
    )
