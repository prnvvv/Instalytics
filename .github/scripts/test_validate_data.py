import tempfile
import unittest
from pathlib import Path

import validate_data


class ValidateDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

    def test_accepts_well_formed_csv(self) -> None:
        path = self.root / "valid.csv"
        path.write_text("name,value\nalpha,1\n", encoding="utf-8")

        validate_data.validate_csv(path)

    def test_rejects_csv_rows_with_inconsistent_column_counts(self) -> None:
        path = self.root / "invalid.csv"
        path.write_text("name,value\nalpha\n", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "expected 2 columns"):
            validate_data.validate_csv(path)

    def test_rejects_invalid_json_lines_with_line_number(self) -> None:
        path = self.root / "invalid.jsonl"
        path.write_text('{"valid": true}\nnot-json\n', encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "line 2"):
            validate_data.validate_jsonl(path)


if __name__ == "__main__":
    unittest.main()
