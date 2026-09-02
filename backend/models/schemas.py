# ============================================================
# models/schemas.py
# ============================================================
"""
Pydantic models shared across routes/upload.py, routes/social.py,
services/parser.py, and services/social_analyzer.py.

These schemas describe the normalized (non-raw-Instagram-JSON) shapes
already produced by the service layer.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ------------------------------------------------------------------
# Upload
# ------------------------------------------------------------------

class UploadResponse(BaseModel):
    """Response returned by POST /api/upload."""

    dataset_id: str
    message: str


# ------------------------------------------------------------------
# Normalized relationship item
# ------------------------------------------------------------------

class RelationshipItem(BaseModel):
    """A single normalized Instagram relationship record."""

    username: str
    name: Optional[str] = None
    profile_url: Optional[str] = Field(default=None, alias="profile_url")
    timestamp: Optional[int] = None
    category: Optional[str] = None

    class Config:
        populate_by_name = True


# ------------------------------------------------------------------
# Overview / statistics
# ------------------------------------------------------------------

class OverviewResponse(BaseModel):
    """Response returned by GET /api/social/{dataset_id}/overview."""

    follower_count: int
    following_count: int
    mutual_count: int
    non_follower_count: int
    not_followed_back_count: int
    follow_back_percentage: float
    follower_following_ratio: Optional[float] = None


# ------------------------------------------------------------------
# Paginated relationship list
# ------------------------------------------------------------------

class PaginatedRelationshipResponse(BaseModel):
    """
    Response returned by every relationship-list endpoint in
    routes/social.py (followers, following, mutuals, non-followers,
    not-followed-back, recently-unfollowed, follow requests, close
    friends, hidden story accounts).
    """

    items: List[RelationshipItem]
    total: int
    total_unfiltered: int
    page: int
    limit: int
    available: bool = True