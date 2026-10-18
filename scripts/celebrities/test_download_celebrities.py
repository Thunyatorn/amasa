import csv
from fractions import Fraction
import io
import logging
from pathlib import Path
import random
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from PIL import Image

import download_celebrities as tool


def image_bytes(mode="RGBA", size=(7, 11)):
    output = io.BytesIO()
    Image.new(mode, size).save(output, "PNG")
    return output.getvalue()


class DownloaderTests(unittest.TestCase):
    names = ["Zoë / ../ A:*?", "Zoe / ../ A:*?"]

    def rows(self):
        return [{"label": label, "image": {"bytes": bytes([i])}}
                for i, label in enumerate([0, 1, 0, 1, 0])]

    def test_seed_and_nonfirst(self):
        first = tool.sample_rows(self.rows(), self.names, random.Random(42))
        self.assertEqual(first, tool.sample_rows(self.rows(), self.names, random.Random(42)))
        choices = [tool.sample_rows(self.rows(), self.names, random.Random(seed))[0][0]
                   for seed in range(20)]
        self.assertTrue(any(choice != b"\x00" for choice in choices))
        self.assertEqual(first[1], {0: 3, 1: 2})

    def test_exact_unbiased_interleaved(self):
        # Enumerate every equally likely randrange branch: 1*1*2*2*3 = 12.
        import itertools
        mass = {0: {}, 1: {}}
        for branches in itertools.product(range(1), range(1), range(2), range(2), range(3)):
            rng = unittest.mock.Mock()
            rng.randrange.side_effect = branches
            selected, _ = tool.sample_rows(self.rows(), self.names, rng)
            for label, value in selected.items():
                mass[label][value] = mass[label].get(value, Fraction()) + Fraction(1, 12)
        self.assertEqual(set(mass[0].values()), {Fraction(1, 3)})
        self.assertEqual(set(mass[1].values()), {Fraction(1, 2)})
        self.assertEqual(len(mass[0]), 3)
        self.assertEqual(len(mass[1]), 2)

    def test_sanitize(self):
        self.assertEqual(tool.filename(0, self.names[0]), "0_Zoe_A.jpg")
        self.assertNotEqual(tool.filename(0, self.names[0]), tool.filename(1, self.names[1]))
        for name in ["../../CON", "", "東京", "a\\b:<c>|?*", "a" * 400]:
            file = tool.filename(5, name)
            self.assertEqual(Path(file).name, file)
            self.assertLess(len(file), 140)
            self.assertRegex(file, r"^5_[A-Za-z0-9_-]+\.jpg$")

    def create(self, path):
        return tool.write_output(path, self.names,
                                 {0: image_bytes(), 1: image_bytes("L", (13, 5))}, {0: 3, 1: 2})

    def test_write_rgb_dimensions_and_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out"
            self.assertEqual(self.create(path), (2, 5))
            for label, size in [(0, (7, 11)), (1, (13, 5))]:
                with Image.open(path / tool.filename(label, self.names[label])) as image:
                    self.assertEqual((image.mode, image.format, image.size), ("RGB", "JPEG", size))
            with (path / "metadata.csv").open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([r["celebrity_name"] for r in rows], self.names)
            self.assertEqual(len({r["label_id"] for r in rows}), 2)
            with self.assertRaises(ValueError):
                tool.validate(path, {0: (self.names[0], 99)})

    def test_validation_damage(self):
        for damage in ["missing", "extra", "corrupt", "duplicate", "filename", "count", "mode"]:
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "out"
                self.create(path)
                target = path / tool.filename(0, self.names[0])
                if damage == "missing":
                    target.unlink()
                elif damage == "extra":
                    (path / "extra.jpg").write_bytes(image_bytes())
                elif damage == "corrupt":
                    target.write_bytes(b"bad")
                elif damage == "mode":
                    Image.new("L", (2, 2)).save(target, "JPEG")
                else:
                    metadata = path / "metadata.csv"
                    with metadata.open(encoding="utf-8", newline="") as handle:
                        rows = list(csv.DictReader(handle))
                    if damage == "duplicate":
                        rows.append(rows[0])
                    elif damage == "filename":
                        rows[0]["filename"] = "../escape.jpg"
                    else:
                        rows[0]["total_images_available"] = "0"
                    with metadata.open("w", encoding="utf-8", newline="") as handle:
                        writer = csv.DictWriter(handle, fieldnames=tool.FIELDS)
                        writer.writeheader()
                        writer.writerows(rows)
                with self.assertRaises((ValueError, OSError)):
                    tool.validate(path)

    def test_failure_cleanup_and_existing_protection(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out"
            with self.assertRaisesRegex(ValueError, "Selected image for label 1"):
                tool.write_output(path, self.names, {0: image_bytes(), 1: b"bad"}, {0: 1, 1: 1})
            self.assertEqual(list(Path(tmp).iterdir()), [])
            path.mkdir()
            marker = path / "keep.txt"
            marker.write_text("keep")
            with self.assertRaises(FileExistsError):
                self.create(path)
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(list(path.iterdir()), [marker])

    def test_mock_stream_boundary(self):
        class Stream:
            features = {"label": types.SimpleNamespace(names=self.names)}

            def cast_column(inner, column, feature):
                self.assertEqual(column, "image")
                self.assertFalse(feature.decode)
                return inner

            def __iter__(inner):
                yield {"label": 0, "image": {"bytes": image_bytes()}}
                yield {"label": 1, "image": {"bytes": image_bytes()}}

        loader = unittest.mock.Mock(return_value=Stream())
        fake = types.SimpleNamespace(load_dataset=loader, Image=lambda **kw: types.SimpleNamespace(**kw))
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {"datasets": fake}):
            self.assertEqual(tool.download(Path(tmp) / "out", 42, "revision"), (2, 2))
            kwargs = loader.call_args.kwargs
            self.assertTrue(kwargs["streaming"])
            self.assertEqual(kwargs["storage_options"], {"cache_type": "none"})
            self.assertEqual(kwargs["revision"], "revision")
            self.assertFalse(Path(kwargs["cache_dir"]).exists())

    def test_bad_labels_and_missing_labels(self):
        for rows in [[], [{"label": -1}], [{"label": True}]]:
            with self.assertRaises(ValueError):
                tool.sample_rows(rows, self.names, random.Random(42))

    def test_main_success_summary_and_http_logging(self):
        for name in ("httpx", "httpcore"):
            logger = logging.getLogger(name)
            self.addCleanup(logger.setLevel, logger.level)
            logger.setLevel(logging.INFO)
        with patch.object(tool, "download", return_value=(997, 18184)) as download:
            with self.assertLogs(tool.LOG, level="INFO") as logs:
                self.assertEqual(tool.main(["--output-dir", "synthetic-output", "--seed", "7"]), 0)
        download.assert_called_once_with(Path("synthetic-output"), 7, tool.REVISION)
        self.assertIn("Unique celebrity labels: 997", logs.output[0])
        self.assertIn("Saved images: 997 JPEGs", logs.output[1])
        self.assertIn("18184 source rows", logs.output[2])
        for name in ("httpx", "httpcore"):
            self.assertEqual(logging.getLogger(name).level, logging.WARNING)

    def test_main_validation_error_returns_nonzero(self):
        for name in ("httpx", "httpcore"):
            logger = logging.getLogger(name)
            self.addCleanup(logger.setLevel, logger.level)
        with patch.object(tool, "validate", side_effect=ValueError("Invalid metadata")) as validate:
            with patch.object(tool, "download") as download, self.assertLogs(tool.LOG, level="ERROR") as logs:
                self.assertEqual(tool.main(["--validate-only", "--output-dir", "synthetic-output"]), 1)
        validate.assert_called_once_with(Path("synthetic-output"))
        download.assert_not_called()
        self.assertIn("ValueError: Invalid metadata", logs.output[0])


if __name__ == "__main__":
    unittest.main()
