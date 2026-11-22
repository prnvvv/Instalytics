# ============================================================
# routes/upload.py
# ============================================================
"""
Upload endpoint for Instagram data export ("connections" folder).

Responsibilities:
- Accept the user's uploaded Instagram export (as a ZIP archive containing
  the `connections` folder, since browsers/FastAPI can't upload a raw folder).
- Validate the upload (file type, size, structure).
- Extract it to a per-session directory under `uploads/`.
- Locate the `followers_and_following/` folder inside the extracted data,
  regardless of exact nesting (e.g. `connections/followers_and_following/`
  vs the zip root already being `followers_and_following/`).
- Delegate actual JSON parsing to `services/parser.py`.
- Return a `dataset_id` (session identifier) that subsequent
  `routes/social.py` endpoints use to reference this dataset.
"""

from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, status

# Expected service-layer imports (see explanation at the bottom of this
# response for the exact contract `services/parser.py` must satisfy).
from services.parser import (
    ParsingError,
    find_followers_and_following_dir,
    parse_connections_dataset,
)

router = APIRouter(prefix="/api/upload", tags=["upload"])

UPLOAD_ROOT = Path("uploads")
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024  # 200 MB safety ceiling
ALLOWED_EXTENSIONS = {".zip"}


def _validate_upload_file(file: UploadFile) -> None:
    """Basic sanity checks on the incoming file before touching disk."""
    if file is None or not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file was uploaded.",
        )

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported file type. Please upload the Instagram "
                "'connections' folder as a .zip archive."
            ),
        )


def _safe_extract_zip(zip_path: Path, extract_to: Path) -> None:
    """
    Extract a ZIP archive while guarding against path traversal
    ("zip slip") and clearly invalid archives.
    """
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                member_path = extract_to / member.filename
                resolved = member_path.resolve()
                if not str(resolved).startswith(str(extract_to.resolve())):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid archive contents.",
                    )
            zf.extractall(extract_to)
    except zipfile.BadZipFile as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid ZIP archive.",
        ) from exc


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_connections_dataset(file: UploadFile = File(...)) -> dict:
    """
    Upload the Instagram `connections` export (as a .zip archive).

    Returns a `dataset_id` that must be used to reference this dataset
    on all subsequent Social Graph endpoints.
    """
    _validate_upload_file(file)

    dataset_id = uuid.uuid4().hex
    dataset_dir = UPLOAD_ROOT / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)

    zip_path = dataset_dir / "upload.zip"

    try:
        # Stream to disk with a size guard instead of loading fully into memory.
        size = 0
        with zip_path.open("wb") as out_file:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_SIZE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Uploaded file exceeds the maximum allowed size.",
                    )
                out_file.write(chunk)
    except HTTPException:
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save the uploaded file.",
        ) from exc
    finally:
        await file.close()

    if size == 0:
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    extracted_dir = dataset_dir / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)
    _safe_extract_zip(zip_path, extracted_dir)

    # Locate followers_and_following/ regardless of nesting depth.
    follow_dir: Optional[Path] = find_followers_and_following_dir(extracted_dir)
    if follow_dir is None:
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Could not find a 'followers_and_following' folder inside "
                "the uploaded 'connections' export. Please make sure you "
                "uploaded the correct Instagram data export."
            ),
        )

    try:
        parse_connections_dataset(dataset_id=dataset_id, follow_dir=follow_dir)
    except ParsingError as exc:
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse Instagram export: {exc}",
        ) from exc
    except Exception as exc:
        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while processing the dataset.",
        ) from exc

    return {
        "dataset_id": dataset_id,
        "message": "Dataset uploaded and parsed successfully.",
    }


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(dataset_id: str) -> None:
    """Remove an uploaded dataset and its parsed data from disk."""
    dataset_dir = UPLOAD_ROOT / dataset_id
    if not dataset_dir.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found.",
        )
    shutil.rmtree(dataset_dir, ignore_errors=True)