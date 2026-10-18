#!/usr/bin/env python3
"""Stream one unbiased reservoir sample per celebrity label (Python 3.10+)."""

import argparse
import csv
import io
import logging
import os
from pathlib import Path
import random
import re
import tempfile
import unicodedata

from PIL import Image

DATASET = "tonyassi/celebrity-1000"
REVISION = "64a86cec14f17e94b87c2120e9fb68a1788627cc"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "data" / "celebrities"
FIELDS = ["label_id", "celebrity_name", "filename", "total_images_available"]
LOG = logging.getLogger(__name__)


def filename(label, name):
    # ASCII keeps filenames portable; CSV retains the exact original name.
    safe = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", safe).strip("_-")[:120] or "celebrity"
    return f"{label}_{safe}.jpg"


def sample_rows(rows, names, rng):
    counts, selected = {}, {}
    for index, row in enumerate(rows, 1):
        label = row["label"]
        if type(label) is not int or not 0 <= label < len(names):
            raise ValueError(f"Invalid label at row {index}: {label!r}")
        counts[label] = counts.get(label, 0) + 1
        if rng.randrange(counts[label]) == 0:
            encoded = row["image"]
            if not isinstance(encoded, dict) or not isinstance(encoded.get("bytes"), bytes):
                raise ValueError(f"Row {index}, label {label}: expected embedded image bytes")
            selected[label] = encoded["bytes"]
        if index % 1000 == 0:
            LOG.info("Scanned %d rows; %d labels", index, len(counts))
    if set(counts) != set(range(len(names))):
        raise ValueError("Empty stream or ClassLabel labels missing from stream")
    return selected, counts


def validate(directory, expected=None):
    """Validate files against CSV; optionally compare authoritative stream counts/names."""
    directory = Path(directory)
    with (directory / "metadata.csv").open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise ValueError("Incorrect metadata columns")
        rows = list(reader)
    seen, files = {}, set()
    for row in rows:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("Malformed metadata row")
        label, count = int(row["label_id"]), int(row["total_images_available"])
        name, file = row["celebrity_name"], row["filename"]
        if label < 0 or label in seen or count < 1 or not name or file != filename(label, name):
            raise ValueError("Invalid or duplicate metadata entry")
        seen[label] = (name, count)
        files.add(file)
        with Image.open(directory / file) as picture:
            picture.load()
            if picture.format != "JPEG" or picture.mode != "RGB":
                raise ValueError(f"Expected RGB JPEG: {file}")
    if not rows or {p.name for p in directory.iterdir()} != files | {"metadata.csv"}:
        raise ValueError("Missing/extra output files or empty metadata")
    if expected is not None and seen != expected:
        raise ValueError("Metadata does not match stream label names/counts")
    return len(rows), sum(count for _, count in seen.values())


def write_output(destination, names, selected, counts):
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Destination already exists; choose a new --output-dir: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{destination.name}-", dir=destination.parent) as tmp:
        staging = Path(tmp) / "assets"
        staging.mkdir()
        with (staging / "metadata.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(FIELDS)
            for label in sorted(selected):
                file = filename(label, names[label])
                try:
                    with Image.open(io.BytesIO(selected[label])) as picture:
                        picture.load()
                        picture.convert("RGB").save(staging / file, "JPEG", quality=95)
                except Exception as exc:
                    raise ValueError(f"Selected image for label {label} ({names[label]}) is invalid: {exc}") from exc
                writer.writerow([label, names[label], file, counts[label]])
        result = validate(staging, {i: (names[i], counts[i]) for i in counts})
        # mkdir reserves the destination without replacing an existing user directory.
        destination.mkdir()
        try:
            os.rename(staging, destination)
        except BaseException:
            destination.rmdir()
            raise
    return result


def download(destination, seed, revision):
    if Path(destination).exists() or Path(destination).is_symlink():
        raise FileExistsError(f"Destination already exists: {destination}")
    # Import lazily: offline validation and synthetic tests never need datasets.
    from datasets import Image as DatasetImage, load_dataset

    with tempfile.TemporaryDirectory(prefix="celebrity-stream-") as cache:
        LOG.info("Streaming %s at %s (seed %d)", DATASET, revision, seed)
        stream = load_dataset(
            DATASET, split="train", revision=revision, streaming=True,
            cache_dir=cache, storage_options={"cache_type": "none"},
        )
        feature = stream.features.get("label") if stream.features else None
        names = getattr(feature, "names", None)
        if not names or not all(isinstance(name, str) and name for name in names):
            raise ValueError("Dataset metadata lacks ClassLabel names; cannot safely map labels. "
                             "Check datasets compatibility and the requested revision.")
        stream = stream.cast_column("image", DatasetImage(decode=False))
        selected, counts = sample_rows(stream, names, random.Random(seed))
        LOG.info("Scan complete: %d rows, %d labels; writing selected images", sum(counts.values()), len(counts))
        return write_output(destination, names, selected, counts)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT,
                        help="Exact destination; must not exist for downloads (default: %(default)s)")
    parser.add_argument("--seed", type=int, default=42, help="Reservoir RNG seed (default: 42)")
    parser.add_argument("--revision", default=REVISION, help="Hugging Face dataset revision")
    parser.add_argument("--validate-only", action="store_true", help="Validate existing output offline (requires Pillow)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    try:
        labels, total = (validate(args.output_dir) if args.validate_only else
                         download(args.output_dir, args.seed, args.revision))
    except Exception as exc:
        LOG.error("%s: %s", type(exc).__name__, exc)
        return 1
    LOG.info("Unique celebrity labels: %d", labels)
    LOG.info("Saved images: %d JPEGs", labels)
    LOG.info("Validated %d source rows: %s", total, args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
