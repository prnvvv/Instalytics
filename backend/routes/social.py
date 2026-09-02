# ============================================================
# routes/social.py
# ============================================================
"""
REST endpoints for Feature 1: Social Graph & Follow Analytics.

These routes are intentionally thin. All set operations (mutuals,
non-followers, not-followed-back, etc.), filtering, sorting, and
pagination logic live in `services/social_analyzer.py`.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from models.schemas import (
    OverviewResponse,
    PaginatedRelationshipResponse,
)
from services.social_analyzer import (
    DatasetNotFoundError,
    get_overview,
    get_relationship_list,
)

router = APIRouter(prefix="/api/social", tags=["social"])

# Every relationship-style list endpoint below maps to one of these
# categories understood by `social_analyzer.get_relationship_list`.
RelationshipCategory = Literal[
    "followers",
    "following",
    "mutuals",
    "non_followers",           # you follow them, they don't follow you back
    "not_followed_back",       # they follow you, you don't follow back
    "recently_unfollowed",
    "recent_follow_requests",
    "pending_follow_requests",
    "received_follow_requests",
    "close_friends",
    "hidden_story_from",
]

SortOption = Literal["username_asc", "username_desc", "timestamp_asc", "timestamp_desc"]


class RelationshipListQuery(BaseModel):
    """
    Query parameters shared by every paginated relationship-list endpoint.

    Declared as a dependency (Annotated[..., Depends()]) so FastAPI exposes
    each field as a QUERY parameter instead of a request body. A plain
    `dict`/model parameter on a GET route would otherwise be misread as a
    JSON request body and make Swagger emit `-d '{}'`.
    """

    search: Optional[str] = Query(
        default=None, description="Case-insensitive substring search on username or name."
    )
    sort: SortOption = Query(
        default="username_asc", description="Sort order for the returned list."
    )
    page: int = Query(default=1, ge=1, description="1-indexed page number.")
    limit: int = Query(default=25, ge=1, le=200, description="Items per page (max 200).")


def _fetch_list(dataset_id: str, category: RelationshipCategory, params: RelationshipListQuery):
    try:
        return run_in_threadpool(
            get_relationship_list,
            dataset_id=dataset_id,
            category=category,
            search=params.search,
            sort=params.sort,
            page=params.page,
            limit=params.limit,
        )
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found. Please upload your export first.",
        ) from exc


ListQuery = Annotated[RelationshipListQuery, Depends()]


@router.get("/{dataset_id}/overview", response_model=OverviewResponse)
async def overview(dataset_id: str) -> OverviewResponse:
    """
    Return follower/following counts, mutuals, non-followers,
    not-followed-back, follow-back percentage, and follower/following ratio.
    """
    try:
        return await run_in_threadpool(get_overview, dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found. Please upload your export first.",
        ) from exc


@router.get("/{dataset_id}/followers", response_model=PaginatedRelationshipResponse)
async def followers(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "followers", params)


@router.get("/{dataset_id}/following", response_model=PaginatedRelationshipResponse)
async def following(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "following", params)


@router.get("/{dataset_id}/mutuals", response_model=PaginatedRelationshipResponse)
async def mutuals(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "mutuals", params)


@router.get("/{dataset_id}/non-followers", response_model=PaginatedRelationshipResponse)
async def non_followers(dataset_id: str, params: ListQuery):
    """People the user follows who do NOT follow them back."""
    return await _fetch_list(dataset_id, "non_followers", params)


@router.get("/{dataset_id}/not-followed-back", response_model=PaginatedRelationshipResponse)
async def not_followed_back(dataset_id: str, params: ListQuery):
    """People who follow the user whom the user does NOT follow back."""
    return await _fetch_list(dataset_id, "not_followed_back", params)


@router.get("/{dataset_id}/recently-unfollowed", response_model=PaginatedRelationshipResponse)
async def recently_unfollowed(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "recently_unfollowed", params)


@router.get("/{dataset_id}/follow-requests/recent", response_model=PaginatedRelationshipResponse)
async def recent_follow_requests(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "recent_follow_requests", params)


@router.get("/{dataset_id}/follow-requests/pending", response_model=PaginatedRelationshipResponse)
async def pending_follow_requests(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "pending_follow_requests", params)


@router.get("/{dataset_id}/follow-requests/received", response_model=PaginatedRelationshipResponse)
async def received_follow_requests(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "received_follow_requests", params)


@router.get("/{dataset_id}/close-friends", response_model=PaginatedRelationshipResponse)
async def close_friends(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "close_friends", params)


@router.get("/{dataset_id}/hidden-story-from", response_model=PaginatedRelationshipResponse)
async def hidden_story_from(dataset_id: str, params: ListQuery):
    return await _fetch_list(dataset_id, "hidden_story_from", params)
