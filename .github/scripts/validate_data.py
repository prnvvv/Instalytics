import csv
import json
import sys
from pathlib import Path
from typing import Iterable


DATA_SUFFIXES = {".csv", ".json", ".jsonl"}
IGNORED_DIRECTORIES = {".git", ".venv", "node_modules", "__pycache__"}


def data_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if any(part in IGNORED_DIRECTORIES for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in DATA_SUFFIXES:
            yield path


def validate_json(path: Path) -> None:
    with path.open(encoding="utf-8-sig") as file:
        json.load(file)


def validate_jsonl(path: Path) -> None:
    with path.open(encoding="utf-8-sig") as file:
        for line_number, line in enumerate(file, start=1):
            if line.strip():
                try:
                    json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"line {line_number}: {error.msg}") from error


def validate_csv(path: Path) -> None:
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file, strict=True)
        try:
            header = next(reader, None)
            if not header or any(not column.strip() for column in header):
                raise ValueError("missing or empty header")
            if len(header) != len(set(header)):
                raise ValueError("duplicate header columns")

            for row in reader:
                if row and len(row) != len(header):
                    raise ValueError(
                        f"line {reader.line_num}: expected {len(header)} columns, "
                        f"found {len(row)}"
                    )
        except csv.Error as error:
            raise ValueError(f"line {reader.line_num}: {error}") from error


def validate_file(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix == ".json":
        validate_json(path)
    elif suffix == ".jsonl":
        validate_jsonl(path)
    elif suffix == ".csv":
        validate_csv(path)


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    files = sorted(data_files(root))
    failures = []

    for path in files:
        try:
            validate_file(path)
        except (OSError, UnicodeError, json.JSONDecodeError, csv.Error, ValueError) as error:
            failures.append((path, error))

    if failures:
        for path, error in failures:
            print(f"ERROR {path.relative_to(root)}: {error}", file=sys.stderr)
        print(f"Data validation failed for {len(failures)} of {len(files)} file(s).")
        return 1

    print(f"Validated {len(files)} CSV, JSON, and JSON Lines file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
