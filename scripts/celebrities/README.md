# Celebrity asset preparation

Standalone Python 3.10+ tool; no website integration. From the repository root:

```sh
uv venv --python 3.13 scripts/celebrities/.venv
uv pip install --python scripts/celebrities/.venv/bin/python -r scripts/celebrities/requirements.txt
scripts/celebrities/.venv/bin/python -m unittest discover -s scripts/celebrities -v
scripts/celebrities/.venv/bin/python scripts/celebrities/download_celebrities.py --seed 42
scripts/celebrities/.venv/bin/python scripts/celebrities/download_celebrities.py --validate-only
```

Alternatively, create and install the environment with standard Python tooling,
then use the same test, download, and validation commands above:

```sh
python3 -m venv scripts/celebrities/.venv
scripts/celebrities/.venv/bin/python -m pip install -r scripts/celebrities/requirements.txt
```

Verified real run: Python 3.13.5, datasets 4.8.5, and Pillow 12.3.0 scanned
18,184 records and produced 997 JPEGs plus 997 metadata rows in
`data/celebrities` (approximately 20 MiB). All eight original unit tests and
offline validation passed. The output contains only those JPEGs and `metadata.csv`.

Default output is `data/celebrities` relative to the script's repository root,
independent of working directory. `--output-dir /absolute/path` is the exact
destination. Downloads refuse any existing destination; choose a new directory
for a rerun, or move the previous output yourself. No confirmation is needed.
Use `--help` for options, including `--revision`.

The source is Hugging Face `tonyassi/celebrity-1000`, train split. The default
revision is `64a86cec14f17e94b87c2120e9fb68a1788627cc`, verified as 18,184
rows and 997 ClassLabel labels despite the dataset's name. The expected labels
come from metadata, not a hardcoded 997. Aliases/alternate spellings remain
separate labels: this is label identity, not real-world person deduplication.
Original celebrity names are preserved in UTF-8 CSV.

One stable, unshuffled pass counts every row. On the nth row of each label,
its encoded-byte candidate is replaced with probability 1/n. For any row i,
P(select_i) = 1/i * product(j=i+1..n, 1-1/j) = 1/n.
Thus every row has equal probability, including interleaved labels. The first
row is only an initial candidate. Reproducibility depends on seed, revision,
row order, and the same RNG implementation.

Streaming uses `datasets.Image(decode=False)` and Pillow only for the chosen
images; no torch/torchcodec is needed. Memory holds one encoded image and count
per label, plus streaming buffers, never the entire dataset. All rows must be
transferred/scanned to sample exactly. A temporary datasets cache and fsspec
`cache_type=none` avoid a persistent full parquet/shard download. There is no
full-dataset fallback. Metadata incompatibility or network failures are reported
as failures; install supported dependencies and check the revision/connectivity.

Output contains only `{label_id}_{sanitized_name}.jpg` files and `metadata.csv`
with exactly `label_id,celebrity_name,filename,total_images_available`.
ASCII-safe, bounded names and label prefixes prevent traversal and collisions.
JPEGs are RGB at original pixel dimensions (no resize or EXIF transpose).
An invalid chosen image fails the run rather than biasing sampling by retrying.
Same-parent staging is checked before publication and cleaned on failure;
existing output is protected. A brief empty destination reservation precedes
the final directory rename; metadata appears only with the validated images.

Validation loads every JPEG and checks format/mode, exact files, unique IDs,
positive counts, and CSV names/filenames. During download it also compares all
names/counts with the stream. Offline `--validate-only` needs Pillow but no
datasets import or network; it checks internal consistency, not source counts
against a new scan. Keep the seed/revision command for provenance.
